-- Prodmazul · Fase 5 · Parte 3 · Migración 14: programación del exportador (cada 2 horas), «sincronizar ahora» y registro de ejecuciones.
-- No cambia ninguna tabla de Recepción ni la aplicación web. Solo agrega:
--   * las extensiones pg_net (llamadas HTTP), pg_cron (programación) y Vault (guardar secretos);
--   * core.sync_ejecuciones: una fila por cada vez que el exportador corre;
--   * core.sync_disparar(): pide al exportador (Edge Function) que trabaje, usando los secretos de Vault;
--   * core.sync_programar() / core.sync_pausar(): activan o detienen la tarea cada 2 horas;
--   * core.sync_encolar_catalogos(): vuelve a anotar los catálogos (se usa el 1 de enero para llenar el libro del año nuevo);
--   * public.api_sync_ahora() y public.api_sync_ejecuciones(): para el administrador;
--   * public.sync_ejecucion_abrir() y sync_ejecucion_cerrar(): solo para la función del servidor.

-- Si alguna extensión no se pudo activar aquí, la migración continúa con un AVISO (no con error) y la guía
-- (paso 4) te pide activarla desde el panel; la prueba del paso 5 también lo verifica.
do $ext$
begin
  begin create extension if not exists pg_net with schema extensions;
  exception when others then raise warning 'AVISO: no se pudo activar pg_net (%). Actívala en Supabase > Integrations.', sqlerrm; end;
  begin create extension if not exists pg_cron;
  exception when others then raise warning 'AVISO: no se pudo activar pg_cron (%). Actívala en Supabase > Integrations.', sqlerrm; end;
  begin create extension if not exists supabase_vault with schema vault;
  exception when others then raise warning 'AVISO: no se pudo activar Vault (%). Actívala en Supabase > Integrations.', sqlerrm; end;
end $ext$;

-- ---------------------------------------------------------------- 1) registro de ejecuciones
create table core.sync_ejecuciones (
  ejecucion_id  bigint generated always as identity primary key,
  origen        text        not null check (origen in ('cron', 'manual', 'prueba')),
  pedida_en     timestamptz not null default now(),
  request_id    bigint,                              -- identificador de la llamada HTTP (pg_net)
  iniciada_en   timestamptz,
  terminada_en  timestamptz,
  estado        text        not null default 'pedida'
                check (estado in ('pedida', 'en_curso', 'ok', 'con_error')),
  lotes         integer     not null default 0,
  filas         integer     not null default 0,
  quedan        integer,                             -- filas que siguen por enviar al terminar
  error         text
);
create index sync_ejecuciones_fecha_idx on core.sync_ejecuciones (pedida_en desc);

alter table core.sync_ejecuciones enable row level security;
revoke all on core.sync_ejecuciones from public, anon, authenticated;

-- ---------------------------------------------------------------- 2) leer un secreto de Vault
create function core.sync_secreto(p_nombre text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = p_nombre order by created_at desc limit 1;
  return nullif(btrim(v), '');
end $$;

-- ---------------------------------------------------------------- 3) pedir al exportador que trabaje
-- Con origen «cron» NUNCA lanza error: lo deja anotado (así una tarea programada fallida se ve en la aplicación).
create function core.sync_disparar(p_origen text default 'manual') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_url text; v_sec text; v_id bigint; v_req bigint;
begin
  if p_origen not in ('cron', 'manual', 'prueba') then
    raise exception 'E_DATOS|Origen no válido.';
  end if;
  begin
    v_url := core.sync_secreto('sync_funcion_url');
    v_sec := core.sync_secreto('sync_secreto');
    if v_url is null then raise exception 'E_CONFIG|Falta el secreto «sync_funcion_url» en Vault.'; end if;
    if v_sec is null then raise exception 'E_CONFIG|Falta el secreto «sync_secreto» en Vault.'; end if;
    if v_url !~ '^https://[^ ]+/functions/v1/sync-exportar$' then
      raise exception 'E_CONFIG|El secreto «sync_funcion_url» debe terminar en /functions/v1/sync-exportar.';
    end if;

    insert into core.sync_ejecuciones (origen) values (p_origen) returning ejecucion_id into v_id;
    v_req := net.http_post(
      url := v_url,
      body := jsonb_build_object('origen', p_origen, 'ejecucion_id', v_id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secreto', v_sec),
      timeout_milliseconds := 140000);
    update core.sync_ejecuciones set request_id = v_req where ejecucion_id = v_id;
    return jsonb_build_object('ejecucion_id', v_id, 'request_id', v_req);
  exception when others then
    if p_origen <> 'cron' then raise; end if;
    insert into core.sync_ejecuciones (origen, estado, terminada_en, error)
    values ('cron', 'con_error', now(), left(sqlerrm, 500));
    update core.sync_estado set ultimo_intento_en = now(), ultimo_error = left(sqlerrm, 500), ultimo_error_en = now() where id = 1;
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
end $$;

-- ---------------------------------------------------------------- 4) programar y pausar
create function core.sync_programar() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if core.sync_secreto('sync_funcion_url') is null or core.sync_secreto('sync_secreto') is null then
    raise exception 'E_CONFIG|Antes de programar, guarda en Vault los secretos «sync_funcion_url» y «sync_secreto».';
  end if;
  -- Cada 2 horas, en punto (hora UTC; al ser cada 2 horas el huso horario no cambia nada).
  perform cron.schedule('prodmazul-sync-exportar', '0 */2 * * *', $job$select core.sync_disparar('cron')$job$);
  -- 1 de enero a las 00:10 hora de Ecuador (05:10 UTC): vuelve a anotar los catálogos para el libro del año nuevo.
  perform cron.schedule('prodmazul-sync-catalogos-anio', '10 5 1 1 *', $job$select core.sync_encolar_catalogos()$job$);
  update core.config set valor = 'true'::jsonb where clave = 'sync_activa';
  perform core.auditar('CORE', 'sync_programar', 'sync', null, jsonb_build_object('cada', '2 horas'));
  return jsonb_build_object('programada', true, 'tareas', jsonb_build_array('prodmazul-sync-exportar', 'prodmazul-sync-catalogos-anio'));
end $$;

create function core.sync_pausar() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from cron.job where jobname = 'prodmazul-sync-exportar') then
    perform cron.unschedule('prodmazul-sync-exportar');
  end if;
  if exists (select 1 from cron.job where jobname = 'prodmazul-sync-catalogos-anio') then
    perform cron.unschedule('prodmazul-sync-catalogos-anio');
  end if;
  update core.config set valor = 'false'::jsonb where clave = 'sync_activa';
  perform core.auditar('CORE', 'sync_pausar', 'sync', null, '{}'::jsonb);
  return jsonb_build_object('programada', false);
end $$;

-- ---------------------------------------------------------------- 5) catálogos para un libro de año nuevo
create function core.sync_encolar_catalogos() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  t record; v_n bigint; v_total bigint := 0; v_pares text;
begin
  for t in select tabla, columnas_clave from core.sync_tablas where orden < 10 order by orden loop
    select string_agg(format('%L, %I', c, c), ', ') into v_pares from unnest(t.columnas_clave) c;
    execute format(
      'insert into core.sync_cola (tabla, clave, clave_json, operacion)
       select %L, jsonb_build_object(%s)::text, jsonb_build_object(%s), ''upsert'' from %s
       on conflict (tabla, clave) where estado = ''pendiente'' do update set operacion = ''upsert'', cambiado_en = now()',
      t.tabla, v_pares, v_pares, t.tabla);
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------- 6) funciones para la función del servidor (Edge Function)
-- Abre (o crea) el registro de una ejecución.
create function public.sync_ejecucion_abrir(p_id bigint, p_origen text default 'manual') returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint := p_id; v_origen text := case when p_origen in ('cron', 'manual', 'prueba') then p_origen else 'manual' end;
begin
  delete from core.sync_ejecuciones where pedida_en < now() - interval '30 days';
  if v_id is not null then
    update core.sync_ejecuciones set estado = 'en_curso', iniciada_en = now()
     where ejecucion_id = v_id and estado = 'pedida';
    if found then return v_id; end if;
  end if;
  insert into core.sync_ejecuciones (origen, estado, iniciada_en) values (v_origen, 'en_curso', now())
  returning ejecucion_id into v_id;
  return v_id;
end $$;

create function public.sync_ejecucion_cerrar(
  p_id bigint, p_estado text, p_lotes integer, p_filas integer, p_error text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_max integer := core.sync_cfg_int('sync_max_intentos', 5);
  v_quedan integer;
  v_txt text := nullif(left(btrim(coalesce(p_error, '')), 500), '');
begin
  if p_estado not in ('ok', 'con_error') then raise exception 'E_DATOS|Estado no válido.'; end if;
  select count(*) into v_quedan from core.sync_cola
   where estado in ('pendiente', 'enviando') or (estado = 'error' and intentos < v_max);
  update core.sync_ejecuciones
     set estado = p_estado, terminada_en = now(), lotes = greatest(coalesce(p_lotes, 0), 0),
         filas = greatest(coalesce(p_filas, 0), 0), quedan = v_quedan, error = v_txt
   where ejecucion_id = p_id;
  if not found then raise exception 'E_LOTE|La ejecución no existe.'; end if;
  if v_txt is not null then
    update core.sync_estado set ultimo_error = v_txt, ultimo_error_en = now() where id = 1;
  end if;
  return jsonb_build_object('ejecucion_id', p_id, 'quedan', v_quedan);
end $$;

-- ---------------------------------------------------------------- 7) funciones para el administrador
create function public.api_sync_ahora() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r jsonb;
begin
  perform core.exigir('M01', 'admin_config');
  v_r := core.sync_disparar('manual');
  perform core.auditar('CORE', 'sync_ahora', 'sync', v_r ->> 'ejecucion_id', '{}'::jsonb);
  return v_r;
end $$;

create function public.api_sync_ejecuciones(p_n integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_programada boolean; v_lista jsonb;
begin
  perform core.exigir('M01', 'admin_config');
  v_programada := exists (select 1 from cron.job where jobname = 'prodmazul-sync-exportar');
  select coalesce(jsonb_agg(to_jsonb(x) order by x.ejecucion_id desc), '[]'::jsonb) into v_lista
    from (select e.ejecucion_id, e.origen, e.pedida_en, e.iniciada_en, e.terminada_en,
                 case when e.estado = 'pedida' and e.pedida_en < now() - interval '5 minutes' then 'sin_respuesta' else e.estado end as estado,
                 e.lotes, e.filas, e.quedan, e.error
            from core.sync_ejecuciones e
           order by e.ejecucion_id desc limit greatest(1, least(coalesce(p_n, 20), 100))) x;
  return jsonb_build_object('programada', v_programada, 'ejecuciones', v_lista);
end $$;

-- ---------------------------------------------------------------- 8) permisos de ejecución
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('sync_ejecucion_abrir', 'sync_ejecucion_cerrar', 'api_sync_ahora', 'api_sync_ejecuciones')
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
