-- Prodmazul · Fase 5 · Parte 4 · Migración 15: respaldo de fotos en Google Drive.
-- No cambia las tablas de Recepción ni la aplicación web. Agrega:
--   * core.sync_fotos: intentos, espera y último error de cada foto que se está respaldando;
--   * columnas nuevas en core.sync_estado y core.sync_ejecuciones (cuántas fotos se respaldaron);
--   * public.sync_fotos_pendientes(): «dame las próximas fotos sin respaldo» (solo para la función del servidor);
--   * public.sync_foto_marcar_ok() y sync_foto_marcar_error(): el resultado de cada foto (solo para la función del servidor);
--   * core.sync_fotos_olvidar(): para repetir el respaldo de una foto (solo administrador de la base);
--   * versiones ampliadas de sync_ejecucion_cerrar, api_sync_estado y api_sync_reintentar_errores.
-- Una foto cuenta como respaldada SOLO cuando Drive confirmó que guardó el archivo (drive_file_id y respaldo_drive_en).

-- ---------------------------------------------------------------- 1) intentos por foto
create table core.sync_fotos (
  foto_id             text primary key references m01_recepcion.fotos_meta (foto_id) on delete cascade,
  intentos            integer     not null default 0,
  reservado_hasta     timestamptz,
  proximo_intento_en  timestamptz,
  ultimo_error        text,
  actualizado_en      timestamptz not null default now()
);
alter table core.sync_fotos enable row level security;
revoke all on core.sync_fotos from public, anon, authenticated;

alter table core.sync_estado
  add column fotos_respaldadas     bigint not null default 0,
  add column ultima_foto_ok_en     timestamptz,
  add column ultimo_error_foto     text,
  add column ultimo_error_foto_en  timestamptz;

alter table core.sync_ejecuciones
  add column fotos        integer not null default 0,
  add column fotos_error  integer not null default 0,
  add column quedan_fotos integer;

-- ---------------------------------------------------------------- 2) las próximas fotos sin respaldo
-- Reserva las fotos entregadas (igual que los lotes de datos): si la función se cae a medias, la reserva vence sola.
create function public.sync_fotos_pendientes(p_max integer default 5) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_max     integer := core.sync_cfg_int('sync_max_intentos', 5);
  v_reserva integer := core.sync_cfg_int('sync_reserva_minutos', 15);
  v_n       integer := greatest(1, least(coalesce(p_max, 5), 10));
  v_fotos   jsonb;
  v_total   integer;
begin
  with elegidas as (
    select f.foto_id
      from m01_recepcion.fotos_meta f
      left join core.sync_fotos s on s.foto_id = f.foto_id
     where f.confirmada and f.drive_file_id is null and f.purgada_supabase_en is null
       and coalesce(s.intentos, 0) < v_max
       and coalesce(s.proximo_intento_en, now()) <= now()
       and coalesce(s.reservado_hasta, now()) <= now()
     order by f.subido_en, f.foto_id
     limit v_n
     for update of f skip locked),
  reservadas as (
    insert into core.sync_fotos as t (foto_id, intentos, reservado_hasta, actualizado_en)
    select foto_id, 1, now() + make_interval(mins => v_reserva), now() from elegidas
    on conflict (foto_id) do update
      set intentos = t.intentos + 1, reservado_hasta = now() + make_interval(mins => v_reserva),
          proximo_intento_en = null, actualizado_en = now()
    returning t.foto_id, t.intentos)
  select coalesce(jsonb_agg(jsonb_build_object(
           'foto_id', f.foto_id, 'recepcion_id', f.recepcion_id, 'lote_id', f.lote_id, 'nn', f.nn,
           'ruta', f.ruta, 'tipo_mime', f.tipo_mime,
           'bytes_esperados', coalesce((select (o.metadata ->> 'size')::bigint from storage.objects o
                                         where o.bucket_id = 'm01-recepcion-fotos' and o.name = f.ruta limit 1), f.tamano_bytes),
           'intento', r.intentos) order by f.subido_en, f.foto_id), '[]'::jsonb)
    into v_fotos
    from reservadas r
    join m01_recepcion.fotos_meta f on f.foto_id = r.foto_id;

  select count(*) into v_total
    from m01_recepcion.fotos_meta f left join core.sync_fotos s on s.foto_id = f.foto_id
   where f.confirmada and f.drive_file_id is null and f.purgada_supabase_en is null and coalesce(s.intentos, 0) < v_max;

  return jsonb_build_object('vacio', jsonb_array_length(v_fotos) = 0, 'fotos', v_fotos, 'pendientes_total', v_total);
end $$;

-- ---------------------------------------------------------------- 3) resultado de cada foto
create function public.sync_foto_marcar_ok(p_foto_id text, p_drive_file_id text, p_bytes bigint default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_f m01_recepcion.fotos_meta;
begin
  if p_drive_file_id is null or p_drive_file_id !~ '^[A-Za-z0-9_-]{10,100}$' then
    raise exception 'E_DATOS|El identificador de Drive no es válido.';
  end if;
  select * into v_f from m01_recepcion.fotos_meta where foto_id = p_foto_id for update;
  if not found then
    raise exception 'E_NO_ENCONTRADO|La foto ya no existe.';
  end if;
  if v_f.drive_file_id is not null then
    return jsonb_build_object('foto_id', p_foto_id, 'ya_respaldada', true);
  end if;
  update m01_recepcion.fotos_meta set drive_file_id = p_drive_file_id, respaldo_drive_en = now() where foto_id = p_foto_id;
  delete from core.sync_fotos where foto_id = p_foto_id;
  update core.sync_estado set fotos_respaldadas = fotos_respaldadas + 1, ultima_foto_ok_en = now() where id = 1;
  perform core.auditar('M01', 'respaldar_foto', 'recepcion', v_f.recepcion_id,
                       jsonb_build_object('foto_id', p_foto_id, 'bytes', p_bytes));
  return jsonb_build_object('foto_id', p_foto_id, 'ya_respaldada', false);
end $$;

create function public.sync_foto_marcar_error(p_foto_id text, p_error text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_max integer := core.sync_cfg_int('sync_max_intentos', 5);
  v_txt text := left(btrim(coalesce(p_error, 'Error sin detalle')), 500);
  v_s   core.sync_fotos;
begin
  update core.sync_fotos
     set ultimo_error = v_txt, reservado_hasta = null, actualizado_en = now(),
         proximo_intento_en = now() + make_interval(mins => least(intentos, 6) * 10)
   where foto_id = p_foto_id
  returning * into v_s;
  if not found then
    raise exception 'E_NO_ENCONTRADO|La foto no estaba reservada para el respaldo.';
  end if;
  update core.sync_estado set ultimo_error_foto = v_txt, ultimo_error_foto_en = now() where id = 1;
  return jsonb_build_object('foto_id', p_foto_id, 'intentos', v_s.intentos, 'agotada', v_s.intentos >= v_max);
end $$;

-- Para repetir el respaldo de una foto (por ejemplo, si se perdió en Drive): la deja como «sin respaldo».
create function core.sync_fotos_olvidar(p_foto_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update m01_recepcion.fotos_meta set drive_file_id = null, respaldo_drive_en = null where foto_id = p_foto_id;
  if not found then return false; end if;
  delete from core.sync_fotos where foto_id = p_foto_id;
  return true;
end $$;

-- ---------------------------------------------------------------- 4) cierre de la ejecución, ahora con fotos
drop function public.sync_ejecucion_cerrar(bigint, text, integer, integer, text);
create function public.sync_ejecucion_cerrar(
  p_id bigint, p_estado text, p_lotes integer, p_filas integer, p_error text default null,
  p_fotos integer default 0, p_fotos_error integer default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_max integer := core.sync_cfg_int('sync_max_intentos', 5);
  v_quedan integer;
  v_quedan_fotos integer;
  v_txt text := nullif(left(btrim(coalesce(p_error, '')), 500), '');
begin
  if p_estado not in ('ok', 'con_error') then raise exception 'E_DATOS|Estado no válido.'; end if;
  select count(*) into v_quedan from core.sync_cola
   where estado in ('pendiente', 'enviando') or (estado = 'error' and intentos < v_max);
  select count(*) into v_quedan_fotos
    from m01_recepcion.fotos_meta f left join core.sync_fotos s on s.foto_id = f.foto_id
   where f.confirmada and f.drive_file_id is null and f.purgada_supabase_en is null and coalesce(s.intentos, 0) < v_max;
  update core.sync_ejecuciones
     set estado = p_estado, terminada_en = now(), lotes = greatest(coalesce(p_lotes, 0), 0),
         filas = greatest(coalesce(p_filas, 0), 0), quedan = v_quedan, error = v_txt,
         fotos = greatest(coalesce(p_fotos, 0), 0), fotos_error = greatest(coalesce(p_fotos_error, 0), 0),
         quedan_fotos = v_quedan_fotos
   where ejecucion_id = p_id;
  if not found then raise exception 'E_LOTE|La ejecución no existe.'; end if;
  if v_txt is not null then
    update core.sync_estado set ultimo_error = v_txt, ultimo_error_en = now() where id = 1;
  end if;
  return jsonb_build_object('ejecucion_id', p_id, 'quedan', v_quedan, 'quedan_fotos', v_quedan_fotos);
end $$;

-- La lista de ejecuciones del administrador ahora incluye las fotos.
create or replace function public.api_sync_ejecuciones(p_n integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_programada boolean; v_lista jsonb;
begin
  perform core.exigir('M01', 'admin_config');
  v_programada := exists (select 1 from cron.job where jobname = 'prodmazul-sync-exportar');
  select coalesce(jsonb_agg(to_jsonb(x) order by x.ejecucion_id desc), '[]'::jsonb) into v_lista
    from (select e.ejecucion_id, e.origen, e.pedida_en, e.iniciada_en, e.terminada_en,
                 case when e.estado = 'pedida' and e.pedida_en < now() - interval '5 minutes' then 'sin_respuesta' else e.estado end as estado,
                 e.lotes, e.filas, e.quedan, e.fotos, e.fotos_error, e.quedan_fotos, e.error
            from core.sync_ejecuciones e
           order by e.ejecucion_id desc limit greatest(1, least(coalesce(p_n, 20), 100))) x;
  return jsonb_build_object('programada', v_programada, 'ejecuciones', v_lista);
end $$;

-- ---------------------------------------------------------------- 5) estado y reintentos, ahora con fotos
create or replace function public.api_sync_estado() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_max integer := core.sync_cfg_int('sync_max_intentos', 5);
  v_horas integer := core.sync_cfg_int('sync_alerta_horas', 6);
  v_e core.sync_estado;
  v_activa boolean := coalesce((select (valor = 'true'::jsonb) from core.config where clave = 'sync_activa'), false);
  v_pend integer; v_env integer; v_err integer; v_ago integer; v_viejo timestamptz; v_fotos integer;
  v_fotos_err integer; v_fotos_ago integer; v_fotos_ok bigint;
  v_horas_sin numeric;
begin
  perform core.exigir('M01', 'admin_config');
  select * into v_e from core.sync_estado where id = 1;
  select count(*) filter (where estado = 'pendiente'),
         count(*) filter (where estado = 'enviando'),
         count(*) filter (where estado = 'error' and intentos < v_max),
         count(*) filter (where estado = 'error' and intentos >= v_max),
         min(cambiado_en) filter (where estado = 'pendiente')
    into v_pend, v_env, v_err, v_ago, v_viejo
    from core.sync_cola;
  select count(*) into v_fotos from m01_recepcion.fotos_meta
   where confirmada and drive_file_id is null and purgada_supabase_en is null;
  select count(*) filter (where s.ultimo_error is not null and s.intentos < v_max),
         count(*) filter (where s.intentos >= v_max)
    into v_fotos_err, v_fotos_ago
    from core.sync_fotos s join m01_recepcion.fotos_meta f using (foto_id)
   where f.drive_file_id is null and f.purgada_supabase_en is null;
  select count(*) into v_fotos_ok from m01_recepcion.fotos_meta where drive_file_id is not null;
  v_horas_sin := case when v_e.ultima_sync_ok_en is null then null
                      else round(extract(epoch from (now() - v_e.ultima_sync_ok_en)) / 3600.0, 2) end;
  return jsonb_build_object(
    'activa', v_activa,
    'ultima_sync_ok_en', v_e.ultima_sync_ok_en,
    'ultimo_intento_en', v_e.ultimo_intento_en,
    'horas_sin_sincronizar', v_horas_sin,
    'limite_horas', v_horas,
    'alerta', v_activa and (v_e.ultima_sync_ok_en is null or v_horas_sin > v_horas),
    'pendientes', v_pend,
    'en_envio', v_env,
    'con_error', v_err,
    'agotadas', v_ago,
    'pendiente_mas_antiguo_en', v_viejo,
    'fotos_sin_respaldo', v_fotos,
    'fotos_con_error', v_fotos_err,
    'fotos_agotadas', v_fotos_ago,
    'fotos_respaldadas', v_fotos_ok,
    'ultima_foto_ok_en', v_e.ultima_foto_ok_en,
    'ultimo_error_foto', v_e.ultimo_error_foto,
    'ultimo_error_foto_en', v_e.ultimo_error_foto_en,
    'ultimo_error', v_e.ultimo_error,
    'ultimo_error_en', v_e.ultimo_error_en,
    'lotes_enviados', v_e.lotes_enviados,
    'filas_enviadas', v_e.filas_enviadas,
    'lotes_con_error', v_e.lotes_con_error);
end $$;

create or replace function public.api_sync_reintentar_errores() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_f integer;
begin
  perform core.exigir('M01', 'admin_config');
  update core.sync_cola set intentos = 0, proximo_intento_en = null where estado = 'error';
  get diagnostics v_n = row_count;
  update core.sync_fotos set intentos = 0, proximo_intento_en = null, reservado_hasta = null where ultimo_error is not null or intentos > 0;
  get diagnostics v_f = row_count;
  perform core.auditar('CORE', 'sync_reintentar_errores', 'sync_cola', null, jsonb_build_object('filas', v_n, 'fotos', v_f));
  return jsonb_build_object('filas', v_n, 'fotos', v_f);
end $$;

-- ---------------------------------------------------------------- 6) permisos de ejecución
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('sync_fotos_pendientes', 'sync_foto_marcar_ok', 'sync_foto_marcar_error',
                                                  'sync_ejecucion_cerrar', 'api_sync_ejecuciones', 'api_sync_estado', 'api_sync_reintentar_errores')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
    if f.proname like 'api\_%' then
      execute format('grant execute on function %s to authenticated', f.firma);
    elsif exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.firma);
    end if;
  end loop;
end $$;
revoke all on all functions in schema core from public, anon, authenticated;
