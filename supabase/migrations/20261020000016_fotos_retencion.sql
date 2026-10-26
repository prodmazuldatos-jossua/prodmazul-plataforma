-- Prodmazul · Fase 5 · Parte 5 · Migración 16: retención de fotos (borrar de Supabase a los 60 días, SOLO con copia confirmada en Drive).
-- No borra nada por sí sola: la purga la hace la función del servidor (el almacenamiento solo se borra con su propia API),
-- y solo después de que el receptor de Google compruebe EN ESE MOMENTO que el archivo sigue en Drive con el tamaño correcto.
-- Agrega:
--   * parámetros: purga_activa (apagada hasta que programes), purga_gracia_horas (24), dias_retencion_fotos ya existía (60);
--   * core.purga_ejecuciones y core.purga_fotos: registro de cada corrida y errores por foto;
--   * core.purga_disparar(), core.purga_programar(), core.purga_pausar(): la tarea diaria;
--   * public.purga_abrir/purga_cerrar/purga_fotos_candidatas/purga_foto_marcar_ok/purga_foto_marcar_error: solo para la función del servidor;
--   * public.api_purga_ahora() y public.api_purgas(): para el administrador;
--   * api_m01_fotos_recepcion ahora informa cuáles fotos están «archivadas en Drive»; api_m01_eliminar_foto no deja quitar una archivada;
--   * core.sync_fotos_olvidar() se niega a olvidar una foto ya purgada (su única copia está en Drive).
-- La fila de la foto (fotos_meta) SE CONSERVA: solo se marca purgada_supabase_en.

-- ---------------------------------------------------------------- 1) parámetros
insert into core.config (clave, valor) values
  ('purga_activa',        'false'::jsonb),   -- la guía la pone en true al programar la purga diaria
  ('purga_gracia_horas',  '24'::jsonb),      -- la copia de Drive debe tener al menos estas horas desde que se confirmó
  ('purga_max_por_corrida', '200'::jsonb)    -- fotos como máximo por corrida
on conflict (clave) do nothing;

-- ---------------------------------------------------------------- 2) registro de corridas y errores por foto
create table core.purga_ejecuciones (
  purga_id      bigint generated always as identity primary key,
  origen        text        not null check (origen in ('cron', 'manual', 'prueba')),
  pedida_en     timestamptz not null default now(),
  request_id    bigint,
  iniciada_en   timestamptz,
  terminada_en  timestamptz,
  estado        text        not null default 'pedida' check (estado in ('pedida', 'en_curso', 'ok', 'con_error')),
  candidatas    integer     not null default 0,   -- fotos que cumplían la regla de edad y copia
  purgadas      integer     not null default 0,   -- borradas de Supabase
  omitidas      integer     not null default 0,   -- Drive no pudo confirmarlas: NO se borraron
  errores       integer     not null default 0,   -- fallos al borrar o al anotar
  quedan        integer,
  error         text
);
create index purga_ejecuciones_fecha_idx on core.purga_ejecuciones (pedida_en desc);
alter table core.purga_ejecuciones enable row level security;
revoke all on core.purga_ejecuciones from public, anon, authenticated;

create table core.purga_fotos (
  foto_id             text primary key references m01_recepcion.fotos_meta (foto_id) on delete cascade,
  intentos            integer     not null default 0,
  proximo_intento_en  timestamptz,
  ultimo_error        text,
  actualizado_en      timestamptz not null default now()
);
alter table core.purga_fotos enable row level security;
revoke all on core.purga_fotos from public, anon, authenticated;

-- ---------------------------------------------------------------- 3) qué fotos se pueden purgar
-- Regla: confirmada, con copia en Drive (id y fecha), copia confirmada hace más de la gracia, no purgada,
-- y subida hace más de dias_retencion_fotos días. Solo entrega algo si la purga está activa.
create function core.purga_regla(p_foto m01_recepcion.fotos_meta) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_foto.confirmada
     and p_foto.drive_file_id is not null
     and p_foto.respaldo_drive_en is not null
     and p_foto.purgada_supabase_en is null
     and p_foto.respaldo_drive_en <= now() - make_interval(hours => core.sync_cfg_int('purga_gracia_horas', 24))
     and p_foto.subido_en < now() - make_interval(days => core.sync_cfg_int('dias_retencion_fotos', 60))
$$;

create function core.purga_activa() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select valor = 'true'::jsonb from core.config where clave = 'purga_activa'), false)
$$;

create function public.purga_fotos_candidatas(p_max integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_max   integer := core.sync_cfg_int('sync_max_intentos', 5);
  v_n     integer := greatest(1, least(coalesce(p_max, 50), 100));
  v_fotos jsonb;
  v_total integer;
begin
  if not core.purga_activa() then
    return jsonb_build_object('activa', false, 'vacio', true, 'fotos', '[]'::jsonb, 'candidatas_total', 0);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'foto_id', x.foto_id, 'recepcion_id', x.recepcion_id, 'ruta', x.ruta, 'drive_file_id', x.drive_file_id,
           'bytes_esperados', x.bytes, 'subido_en', x.subido_en) order by x.subido_en, x.foto_id), '[]'::jsonb)
    into v_fotos
    from (select f.*, coalesce((select (o.metadata ->> 'size')::bigint from storage.objects o
                                 where o.bucket_id = 'm01-recepcion-fotos' and o.name = f.ruta limit 1), f.tamano_bytes) as bytes
            from m01_recepcion.fotos_meta f left join core.purga_fotos p on p.foto_id = f.foto_id
           where core.purga_regla(f)
             and coalesce(p.intentos, 0) < v_max
             and coalesce(p.proximo_intento_en, now()) <= now()
           order by f.subido_en, f.foto_id limit v_n) x;
  select count(*) into v_total
    from m01_recepcion.fotos_meta f left join core.purga_fotos p on p.foto_id = f.foto_id
   where core.purga_regla(f) and coalesce(p.intentos, 0) < v_max;
  return jsonb_build_object('activa', true, 'vacio', jsonb_array_length(v_fotos) = 0, 'fotos', v_fotos, 'candidatas_total', v_total);
end $$;

-- ---------------------------------------------------------------- 4) resultado de cada foto
-- Se llama DESPUÉS de que el archivo se borró del almacenamiento. Conserva la fila y deja constancia.
create function public.purga_foto_marcar_ok(p_foto_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_f m01_recepcion.fotos_meta;
begin
  select * into v_f from m01_recepcion.fotos_meta where foto_id = p_foto_id for update;
  if not found then raise exception 'E_NO_ENCONTRADO|La foto ya no existe.'; end if;
  if v_f.purgada_supabase_en is not null then
    return jsonb_build_object('foto_id', p_foto_id, 'ya_purgada', true);
  end if;
  if v_f.drive_file_id is null or v_f.respaldo_drive_en is null then
    raise exception 'E_ESTADO|La foto no tiene copia confirmada en Drive: no se puede marcar como purgada.';
  end if;
  update m01_recepcion.fotos_meta set purgada_supabase_en = now() where foto_id = p_foto_id;
  delete from core.purga_fotos where foto_id = p_foto_id;
  perform core.auditar('M01', 'purgar_foto', 'recepcion', v_f.recepcion_id,
                       jsonb_build_object('foto_id', p_foto_id, 'ruta', v_f.ruta, 'drive_file_id', v_f.drive_file_id,
                                          'dias_retencion', core.sync_cfg_int('dias_retencion_fotos', 60)));
  return jsonb_build_object('foto_id', p_foto_id, 'ya_purgada', false);
end $$;

create function public.purga_foto_marcar_error(p_foto_id text, p_error text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_max integer := core.sync_cfg_int('sync_max_intentos', 5);
  v_txt text := left(btrim(coalesce(p_error, 'Error sin detalle')), 500);
  v_p   core.purga_fotos;
begin
  if not exists (select 1 from m01_recepcion.fotos_meta where foto_id = p_foto_id) then
    raise exception 'E_NO_ENCONTRADO|La foto no existe.';
  end if;
  insert into core.purga_fotos as t (foto_id, intentos, ultimo_error, proximo_intento_en, actualizado_en)
  values (p_foto_id, 1, v_txt, now() + interval '1 day', now())
  on conflict (foto_id) do update
    set intentos = t.intentos + 1, ultimo_error = excluded.ultimo_error,
        proximo_intento_en = now() + make_interval(days => least(t.intentos + 1, 7)), actualizado_en = now()
  returning * into v_p;
  return jsonb_build_object('foto_id', p_foto_id, 'intentos', v_p.intentos, 'agotada', v_p.intentos >= v_max);
end $$;

-- ---------------------------------------------------------------- 5) registro de corridas
create function public.purga_abrir(p_id bigint, p_origen text default 'manual') returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint := p_id; v_origen text := case when p_origen in ('cron', 'manual', 'prueba') then p_origen else 'manual' end;
begin
  delete from core.purga_ejecuciones where pedida_en < now() - interval '90 days';
  if v_id is not null then
    update core.purga_ejecuciones set estado = 'en_curso', iniciada_en = now() where purga_id = v_id and estado = 'pedida';
    if found then return v_id; end if;
  end if;
  insert into core.purga_ejecuciones (origen, estado, iniciada_en) values (v_origen, 'en_curso', now()) returning purga_id into v_id;
  return v_id;
end $$;

create function public.purga_cerrar(
  p_id bigint, p_estado text, p_candidatas integer, p_purgadas integer, p_omitidas integer, p_errores integer, p_error text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_max integer := core.sync_cfg_int('sync_max_intentos', 5);
  v_quedan integer;
  v_txt text := nullif(left(btrim(coalesce(p_error, '')), 500), '');
begin
  if p_estado not in ('ok', 'con_error') then raise exception 'E_DATOS|Estado no válido.'; end if;
  select count(*) into v_quedan
    from m01_recepcion.fotos_meta f left join core.purga_fotos p on p.foto_id = f.foto_id
   where core.purga_activa() and core.purga_regla(f) and coalesce(p.intentos, 0) < v_max;
  update core.purga_ejecuciones
     set estado = p_estado, terminada_en = now(), candidatas = greatest(coalesce(p_candidatas, 0), 0),
         purgadas = greatest(coalesce(p_purgadas, 0), 0), omitidas = greatest(coalesce(p_omitidas, 0), 0),
         errores = greatest(coalesce(p_errores, 0), 0), quedan = v_quedan, error = v_txt
   where purga_id = p_id;
  if not found then raise exception 'E_LOTE|La corrida no existe.'; end if;
  return jsonb_build_object('purga_id', p_id, 'quedan', v_quedan);
end $$;

-- ---------------------------------------------------------------- 6) pedir la purga y programarla
create function core.purga_disparar(p_origen text default 'manual') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_sec text; v_id bigint; v_req bigint;
begin
  if p_origen not in ('cron', 'manual', 'prueba') then raise exception 'E_DATOS|Origen no válido.'; end if;
  begin
    v_url := core.sync_secreto('sync_funcion_url');
    v_sec := core.sync_secreto('sync_secreto');
    if v_url is null then raise exception 'E_CONFIG|Falta el secreto «sync_funcion_url» en Vault.'; end if;
    if v_sec is null then raise exception 'E_CONFIG|Falta el secreto «sync_secreto» en Vault.'; end if;
    if v_url !~ '^https://[^ ]+/functions/v1/sync-exportar$' then
      raise exception 'E_CONFIG|El secreto «sync_funcion_url» debe terminar en /functions/v1/sync-exportar.';
    end if;
    insert into core.purga_ejecuciones (origen) values (p_origen) returning purga_id into v_id;
    v_req := net.http_post(
      url := v_url,
      body := jsonb_build_object('accion', 'purgar', 'origen', p_origen, 'purga_id', v_id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secreto', v_sec),
      timeout_milliseconds := 140000);
    update core.purga_ejecuciones set request_id = v_req where purga_id = v_id;
    return jsonb_build_object('purga_id', v_id, 'request_id', v_req);
  exception when others then
    if p_origen <> 'cron' then raise; end if;
    insert into core.purga_ejecuciones (origen, estado, terminada_en, error) values ('cron', 'con_error', now(), left(sqlerrm, 500));
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
end $$;

-- Todos los días a las 03:30 de Ecuador (08:30 UTC), cuando casi nadie usa la aplicación.
create function core.purga_programar() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if core.sync_secreto('sync_funcion_url') is null or core.sync_secreto('sync_secreto') is null then
    raise exception 'E_CONFIG|Antes de programar, guarda en Vault los secretos «sync_funcion_url» y «sync_secreto».';
  end if;
  perform cron.schedule('prodmazul-purga-fotos', '30 8 * * *', $job$select core.purga_disparar('cron')$job$);
  update core.config set valor = 'true'::jsonb where clave = 'purga_activa';
  perform core.auditar('CORE', 'purga_programar', 'purga', null, jsonb_build_object('cada', 'dia', 'hora_ecuador', '03:30'));
  return jsonb_build_object('programada', true, 'tarea', 'prodmazul-purga-fotos');
end $$;

create function core.purga_pausar() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from cron.job where jobname = 'prodmazul-purga-fotos') then
    perform cron.unschedule('prodmazul-purga-fotos');
  end if;
  update core.config set valor = 'false'::jsonb where clave = 'purga_activa';
  perform core.auditar('CORE', 'purga_pausar', 'purga', null, '{}'::jsonb);
  return jsonb_build_object('programada', false);
end $$;

-- ---------------------------------------------------------------- 7) funciones para el administrador
create function public.api_purga_ahora() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r jsonb;
begin
  perform core.exigir('M01', 'admin_config');
  if not core.purga_activa() then
    raise exception 'E_CONFIG|La purga está apagada. Prográmala primero (core.purga_programar()).';
  end if;
  v_r := core.purga_disparar('manual');
  perform core.auditar('CORE', 'purga_ahora', 'purga', v_r ->> 'purga_id', '{}'::jsonb);
  return v_r;
end $$;

create function public.api_purgas(p_n integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_lista jsonb; v_max integer := core.sync_cfg_int('sync_max_intentos', 5);
begin
  perform core.exigir('M01', 'admin_config');
  select coalesce(jsonb_agg(to_jsonb(x) order by x.purga_id desc), '[]'::jsonb) into v_lista
    from (select e.purga_id, e.origen, e.pedida_en, e.iniciada_en, e.terminada_en,
                 case when e.estado = 'pedida' and e.pedida_en < now() - interval '5 minutes' then 'sin_respuesta' else e.estado end as estado,
                 e.candidatas, e.purgadas, e.omitidas, e.errores, e.quedan, e.error
            from core.purga_ejecuciones e order by e.purga_id desc limit greatest(1, least(coalesce(p_n, 20), 100))) x;
  return jsonb_build_object(
    'activa', core.purga_activa(),
    'programada', exists (select 1 from cron.job where jobname = 'prodmazul-purga-fotos'),
    'dias_retencion', core.sync_cfg_int('dias_retencion_fotos', 60),
    'fotos_archivadas', (select count(*) from m01_recepcion.fotos_meta where purgada_supabase_en is not null),
    'candidatas_ahora', (select count(*) from m01_recepcion.fotos_meta f left join core.purga_fotos p on p.foto_id = f.foto_id
                          where core.purga_regla(f) and coalesce(p.intentos, 0) < v_max),
    'ejecuciones', v_lista);
end $$;

-- ---------------------------------------------------------------- 8) la aplicación: fotos archivadas
create or replace function public.api_m01_fotos_recepcion(p_recepcion_id text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.exigir('M01', 'ver');
  if not exists (select 1 from m01_recepcion.recepciones r
                 where r.recepcion_id = p_recepcion_id
                   and (r.estado <> 'eliminado' or core.tiene_permiso('M01', 'eliminar'))) then
    raise exception 'E_NO_ENCONTRADO|La recepción no existe.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
            'foto_id', f.foto_id, 'nn', f.nn, 'nombre', f.nombre, 'tipo_mime', f.tipo_mime,
            'tamano_bytes', f.tamano_bytes, 'ruta', f.ruta, 'subido_en', f.subido_en,
            'archivada', f.purgada_supabase_en is not null, 'archivada_en', f.purgada_supabase_en) order by f.nn)
          from m01_recepcion.fotos_meta f where f.recepcion_id = p_recepcion_id and f.confirmada), '[]'::jsonb);
end $$;

create or replace function public.api_m01_eliminar_foto(p_foto_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_f   m01_recepcion.fotos_meta;
  v_r   m01_recepcion.recepciones;
begin
  perform core.exigir('M01', 'cargar_imagenes');
  select * into v_f from m01_recepcion.fotos_meta where foto_id = p_foto_id for update;
  if not found then
    raise exception 'E_NO_ENCONTRADO|La foto no existe.';
  end if;
  if v_f.purgada_supabase_en is not null then
    raise exception 'E_FOTOS|Esta foto está archivada en Drive y no se puede quitar desde la aplicación.';
  end if;
  select * into v_r from m01_recepcion.recepciones where recepcion_id = v_f.recepcion_id;
  if v_r.estado not in ('borrador', 'cerrado') then
    raise exception 'E_ESTADO|No se pueden quitar fotos de una recepción anulada o eliminada.';
  end if;
  if v_r.creado_por is distinct from v_uid and not core.tiene_permiso('M01', 'eliminar') then
    raise exception 'E_PERMISO|Solo quien creó la recepción (o un administrador) puede quitarle fotos.';
  end if;
  delete from m01_recepcion.fotos_meta where foto_id = p_foto_id;
  perform core.auditar('M01', 'eliminar_foto', 'recepcion', v_f.recepcion_id,
                       jsonb_build_object('foto_id', v_f.foto_id, 'confirmada', v_f.confirmada));
  return jsonb_build_object('foto_id', p_foto_id, 'eliminada', true);
end $$;

-- Una foto ya purgada no se puede «olvidar»: su única copia está en Drive.
create or replace function core.sync_fotos_olvidar(p_foto_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from m01_recepcion.fotos_meta where foto_id = p_foto_id and purgada_supabase_en is not null) then
    raise exception 'E_ESTADO|La foto ya fue purgada de Supabase; su única copia está en Drive.';
  end if;
  update m01_recepcion.fotos_meta set drive_file_id = null, respaldo_drive_en = null where foto_id = p_foto_id;
  if not found then return false; end if;
  delete from core.sync_fotos where foto_id = p_foto_id;
  return true;
end $$;

-- ---------------------------------------------------------------- 9) permisos de ejecución
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('purga_fotos_candidatas', 'purga_foto_marcar_ok', 'purga_foto_marcar_error',
                                                  'purga_abrir', 'purga_cerrar', 'api_purga_ahora', 'api_purgas',
                                                  'api_m01_fotos_recepcion', 'api_m01_eliminar_foto')
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
