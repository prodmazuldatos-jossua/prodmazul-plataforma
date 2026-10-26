-- Prodmazul · Fase 5 · Parte 1 · Migración 13: cola y estado de sincronización
--
-- Qué hace (solo base de datos; no se envía nada a Google todavía):
--   1) core.sync_tablas : lista de las tablas que se copiarán a Google Sheets (hoja, columnas clave y orden).
--   2) core.sync_cola   : cada alta, cambio o borrado de esas tablas queda anotado aquí, sin frenar el guardado.
--   3) core.sync_estado : una sola fila con la última sincronización correcta, el último error y totales.
--   4) Funciones INTERNAS (solo las usa la función de servidor de la Parte 3):
--        sync_proximo_lote(p_max)        entrega el próximo lote de cambios (con su contenido actual) y lo reserva
--        sync_marcar_enviado(p_lote)     confirma que Google lo recibió
--        sync_marcar_error(p_lote, txt)  registra el fallo; se reintenta con espera y con tope
--   5) Funciones para el administrador: api_sync_estado, api_sync_reintentar_errores, api_sync_reencolar_todo.
--   6) Encola de una vez TODO lo que ya existe en la base (la primera sincronización lo incluirá).
--
-- Reglas de diseño:
--   * Supabase sigue siendo la plataforma principal: si anotar en la cola falla, el guardado NO se detiene.
--   * Un mismo registro cambiado 20 veces antes del envío ocupa UNA sola fila pendiente de la cola.
--   * El contenido de cada fila se lee de la tabla en el momento del envío (siempre el dato más reciente);
--     si el registro ya no existe, se envía como «borrar».
--   * Dos llamadas seguidas a sync_proximo_lote nunca entregan lo mismo: lo entregado queda «enviando» (reservado).
--     Si el envío nunca se confirma, la reserva vence y se reintenta.

-- ---------------------------------------------------------------- 1) parámetros
insert into core.config (clave, valor) values
  ('sync_activa',           'false'::jsonb),  -- la Parte 3 la pone en true al programar el envío
  ('sync_tamano_lote',      '200'::jsonb),    -- filas por lote
  ('sync_max_intentos',     '5'::jsonb),      -- intentos antes de dejar una fila como «agotada»
  ('sync_reserva_minutos',  '15'::jsonb),     -- tiempo que un lote entregado espera su confirmación
  ('sync_dias_historial',   '14'::jsonb),     -- días que se conservan las filas ya enviadas
  ('sync_alerta_horas',     '6'::jsonb)       -- horas sin sincronizar para avisar (Parte 6)
on conflict (clave) do nothing;

create function core.sync_cfg_int(p_clave text, p_defecto integer) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when jsonb_typeof(valor) = 'number' then (valor #>> '{}')::numeric::integer end
                   from core.config where clave = p_clave), p_defecto)
$$;

-- ---------------------------------------------------------------- 2) tablas que se copian
create table core.sync_tablas (
  tabla          text primary key,                 -- esquema.tabla
  hoja           text not null unique,             -- nombre de la pestaña en Google Sheets
  columnas_clave text[] not null check (cardinality(columnas_clave) > 0),
  orden          integer not null
);

insert into core.sync_tablas (tabla, hoja, columnas_clave, orden) values
  ('core.proveedores',                       'proveedores',            array['id'],                         1),
  ('core.especies',                          'especies',               array['id'],                         2),
  ('core.lotes',                             'lotes',                  array['lote_id'],                    3),
  ('core.perfiles',                          'perfiles',               array['user_id'],                    4),
  ('core.usuario_modulo_rol',                'usuario_modulo_rol',     array['user_id', 'modulo_id'],       5),
  ('core.config',                            'config',                 array['clave'],                      6),
  ('m01_recepcion.recepciones',              'recepciones',            array['recepcion_id'],              10),
  ('m01_recepcion.recepcion_gavetas',        'recepcion_gavetas',      array['recepcion_id', 'num_gaveta'], 11),
  ('m01_recepcion.recepcion_temperaturas',   'recepcion_temperaturas', array['recepcion_id', 'lectura_id'], 12),
  ('m01_recepcion.recepcion_almacenamiento', 'recepcion_almacenamiento', array['recepcion_id', 'num_bin'],  13),
  ('m01_recepcion.fotos_meta',               'fotos_meta',             array['foto_id'],                   14);

-- ---------------------------------------------------------------- 3) cola
create table core.sync_cola (
  cola_id          bigint generated always as identity primary key,
  tabla            text not null references core.sync_tablas (tabla),
  clave            text not null,                  -- la clave del registro, como texto (para no repetir pendientes)
  clave_json       jsonb not null,                 -- {"recepcion_id": "REC-…", "num_gaveta": 3}
  operacion        text not null check (operacion in ('upsert', 'borrar')),
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviado', 'error')),
  intentos         integer not null default 0,
  ultimo_error     text,
  lote_id          uuid,
  creado_en        timestamptz not null default now(),
  cambiado_en      timestamptz not null default now(),
  reservado_hasta  timestamptz,
  proximo_intento_en timestamptz,
  enviado_en       timestamptz
);
-- Un registro tiene como máximo UNA fila pendiente.
create unique index sync_cola_pendiente_uk on core.sync_cola (tabla, clave) where estado = 'pendiente';
create index sync_cola_estado_idx on core.sync_cola (estado, cola_id);
create index sync_cola_lote_idx   on core.sync_cola (lote_id) where lote_id is not null;
create index sync_cola_clave_idx  on core.sync_cola (tabla, clave);

create table core.sync_estado (
  id                 smallint primary key default 1 check (id = 1),
  ultima_sync_ok_en  timestamptz,
  ultimo_intento_en  timestamptz,
  ultimo_error       text,
  ultimo_error_en    timestamptz,
  lotes_enviados     bigint not null default 0,
  filas_enviadas     bigint not null default 0,
  lotes_con_error    bigint not null default 0
);
insert into core.sync_estado (id) values (1);

alter table core.sync_tablas enable row level security;
alter table core.sync_cola   enable row level security;
alter table core.sync_estado enable row level security;
revoke all on core.sync_tablas, core.sync_cola, core.sync_estado from public, anon, authenticated;

-- ---------------------------------------------------------------- 4) anotar cada cambio (disparador)
create function core.sync_anotar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tabla text := tg_table_schema || '.' || tg_table_name;
  v_fila  jsonb;
  v_vieja jsonb;
  v_clave jsonb;
  v_clave_vieja jsonb;
begin
  -- Anotar es secundario: si algo falla aquí, el guardado de la recepción NO debe detenerse.
  begin
    if tg_op = 'DELETE' then v_fila := to_jsonb(old); else v_fila := to_jsonb(new); end if;
    select jsonb_object_agg(k, v_fila -> k) into v_clave from unnest(tg_argv) as k;

    insert into core.sync_cola (tabla, clave, clave_json, operacion)
    values (v_tabla, v_clave::text, v_clave, case when tg_op = 'DELETE' then 'borrar' else 'upsert' end)
    on conflict (tabla, clave) where estado = 'pendiente'
    do update set operacion = excluded.operacion, cambiado_en = now();

    -- Si cambió la clave del registro, el anterior debe borrarse en la hoja.
    if tg_op = 'UPDATE' then
      v_vieja := to_jsonb(old);
      select jsonb_object_agg(k, v_vieja -> k) into v_clave_vieja from unnest(tg_argv) as k;
      if v_clave_vieja <> v_clave then
        insert into core.sync_cola (tabla, clave, clave_json, operacion)
        values (v_tabla, v_clave_vieja::text, v_clave_vieja, 'borrar')
        on conflict (tabla, clave) where estado = 'pendiente'
        do update set operacion = 'borrar', cambiado_en = now();
      end if;
    end if;
  exception when others then
    raise warning 'sync_anotar: no se pudo anotar un cambio de % (%)', v_tabla, sqlerrm;
  end;
  return null;
end $$;

do $$
declare t record;
begin
  for t in select tabla, columnas_clave from core.sync_tablas loop
    execute format(
      'create trigger sync_anotar after insert or update or delete on %s for each row execute function core.sync_anotar(%s)',
      t.tabla, (select string_agg(quote_literal(c), ', ') from unnest(t.columnas_clave) c));
  end loop;
end $$;

-- ---------------------------------------------------------------- 5) encolar todo lo que ya existe
create function core.sync_encolar_todo() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  t record;
  v_n bigint;
  v_total bigint := 0;
  v_pares text;
begin
  for t in select tabla, columnas_clave from core.sync_tablas order by orden loop
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

-- ---------------------------------------------------------------- 6) entregar el próximo lote
create function public.sync_proximo_lote(p_max integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tam      integer;
  v_max_int  integer := core.sync_cfg_int('sync_max_intentos', 5);
  v_reserva  integer := core.sync_cfg_int('sync_reserva_minutos', 15);
  v_hist     integer := core.sync_cfg_int('sync_dias_historial', 14);
  v_lote     uuid := gen_random_uuid();
  v_min      integer;
  v_filas    integer := 0;
  v_tablas   jsonb := '[]'::jsonb;
  t          record;
  q          record;
  v_cond     text;
  v_dato     jsonb;
  v_datos    jsonb;
  v_borrar   jsonb;
  v_vistas   text[];
begin
  v_tam := greatest(1, least(coalesce(p_max, core.sync_cfg_int('sync_tamano_lote', 200)), 1000));

  update core.sync_estado set ultimo_intento_en = now() where id = 1;

  -- Mantenimiento: se borra lo ya enviado y vencido; y una reserva vencida sin intentos disponibles pasa a «error».
  delete from core.sync_cola where estado = 'enviado' and enviado_en < now() - make_interval(days => v_hist);
  update core.sync_cola
     set estado = 'error', reservado_hasta = null,
         ultimo_error = coalesce(ultimo_error, 'El envío no se confirmó a tiempo.')
   where estado = 'enviando' and reservado_hasta < now() and intentos >= v_max_int;

  -- ¿Hay algo que enviar? Pendientes, errores con intentos disponibles (pasada su espera) o reservas vencidas.
  select min(intentos) into v_min from core.sync_cola
   where estado = 'pendiente'
      or (estado = 'error'    and intentos < v_max_int and coalesce(proximo_intento_en, now()) <= now())
      or (estado = 'enviando' and intentos < v_max_int and reservado_hasta < now());

  if v_min is null then
    -- Cola totalmente al día (sin pendientes, sin reservas vigentes y sin errores, ni siquiera agotados): cuenta como sincronización correcta.
    if not exists (select 1 from core.sync_cola where estado in ('pendiente', 'enviando', 'error')) then
      update core.sync_estado set ultima_sync_ok_en = now() where id = 1;
    end if;
    return jsonb_build_object('vacio', true, 'lote_id', null, 'filas', 0, 'tablas', '[]'::jsonb);
  end if;

  -- Si ya falló dos veces, se prueba con lotes pequeños para aislar el registro que causa el problema.
  if v_min >= 2 then v_tam := least(v_tam, 10); end if;

  with elegidas as (
    select cola_id from core.sync_cola
     where estado = 'pendiente'
        or (estado = 'error'    and intentos < v_max_int and coalesce(proximo_intento_en, now()) <= now())
        or (estado = 'enviando' and intentos < v_max_int and reservado_hasta < now())
     order by intentos, cola_id
     limit v_tam
     for update skip locked)
  update core.sync_cola c
     set estado = 'enviando', lote_id = v_lote, intentos = c.intentos + 1,
         reservado_hasta = now() + make_interval(mins => v_reserva), proximo_intento_en = null
    from elegidas e
   where c.cola_id = e.cola_id;

  -- Contenido del lote: se lee cada registro tal como está ahora.
  for t in select s.tabla, s.hoja, s.columnas_clave from core.sync_tablas s
            where exists (select 1 from core.sync_cola c where c.lote_id = v_lote and c.tabla = s.tabla)
            order by s.orden loop
    select string_agg(format('t.%I = k.%I', c, c), ' and ') into v_cond from unnest(t.columnas_clave) c;
    v_datos := '[]'::jsonb; v_borrar := '[]'::jsonb; v_vistas := '{}';
    for q in select distinct on (clave) clave, clave_json from core.sync_cola
              where lote_id = v_lote and tabla = t.tabla order by clave, cola_id loop
      v_dato := null;
      execute format('select to_jsonb(t) from %s t join (select (jsonb_populate_record(null::%s, $1)).*) k on %s limit 1',
                     t.tabla, t.tabla, v_cond) into v_dato using q.clave_json;
      if v_dato is null then v_borrar := v_borrar || jsonb_build_array(q.clave_json);
      else v_datos := v_datos || jsonb_build_array(v_dato); end if;
    end loop;
    v_filas := v_filas + jsonb_array_length(v_datos) + jsonb_array_length(v_borrar);
    v_tablas := v_tablas || jsonb_build_array(jsonb_build_object(
      'tabla', t.tabla, 'hoja', t.hoja, 'clave', to_jsonb(t.columnas_clave), 'filas', v_datos, 'borrar', v_borrar));
  end loop;

  return jsonb_build_object('vacio', false, 'lote_id', v_lote, 'generado_en', now(), 'filas', v_filas, 'tablas', v_tablas);
end $$;

-- ---------------------------------------------------------------- 7) confirmar o fallar un lote
create function public.sync_marcar_enviado(p_lote uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_viejas integer;
begin
  update core.sync_cola
     set estado = 'enviado', enviado_en = now(), reservado_hasta = null, ultimo_error = null
   where lote_id = p_lote and estado = 'enviando';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'E_LOTE|El lote no existe, ya se confirmó o su reserva venció y se entregó de nuevo.';
  end if;

  -- Lo enviado ya incluye el dato más reciente: las filas con error del mismo registro quedan resueltas.
  update core.sync_cola e
     set estado = 'enviado', enviado_en = now(), reservado_hasta = null
    from core.sync_cola s
   where s.lote_id = p_lote and e.tabla = s.tabla and e.clave = s.clave
     and e.estado = 'error' and e.cola_id < s.cola_id;
  get diagnostics v_viejas = row_count;

  update core.sync_estado
     set ultima_sync_ok_en = now(), lotes_enviados = lotes_enviados + 1, filas_enviadas = filas_enviadas + v_n
   where id = 1;
  return jsonb_build_object('lote_id', p_lote, 'confirmadas', v_n, 'resueltas_por_reenvio', v_viejas);
end $$;

create function public.sync_marcar_error(p_lote uuid, p_error text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_max integer := core.sync_cfg_int('sync_max_intentos', 5);
  v_n integer; v_agotadas integer;
  v_txt text := left(btrim(coalesce(p_error, 'Error sin detalle')), 500);
begin
  update core.sync_cola
     set estado = 'error', ultimo_error = v_txt, reservado_hasta = null,
         proximo_intento_en = now() + make_interval(mins => least(intentos, 6) * 10)
   where lote_id = p_lote and estado = 'enviando';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'E_LOTE|El lote no existe, ya se confirmó o su reserva venció y se entregó de nuevo.';
  end if;
  select count(*) into v_agotadas from core.sync_cola where lote_id = p_lote and estado = 'error' and intentos >= v_max;

  update core.sync_estado
     set ultimo_error = v_txt, ultimo_error_en = now(), lotes_con_error = lotes_con_error + 1
   where id = 1;
  return jsonb_build_object('lote_id', p_lote, 'con_error', v_n, 'agotadas', v_agotadas);
end $$;

-- ---------------------------------------------------------------- 8) funciones para el administrador
create function public.api_sync_estado() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_max integer := core.sync_cfg_int('sync_max_intentos', 5);
  v_horas integer := core.sync_cfg_int('sync_alerta_horas', 6);
  v_e core.sync_estado;
  v_activa boolean := coalesce((select (valor = 'true'::jsonb) from core.config where clave = 'sync_activa'), false);
  v_pend integer; v_env integer; v_err integer; v_ago integer; v_viejo timestamptz; v_fotos integer;
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
    'ultimo_error', v_e.ultimo_error,
    'ultimo_error_en', v_e.ultimo_error_en,
    'lotes_enviados', v_e.lotes_enviados,
    'filas_enviadas', v_e.filas_enviadas,
    'lotes_con_error', v_e.lotes_con_error);
end $$;

-- Devuelve a la cola las filas que agotaron sus intentos (después de corregir la causa).
create function public.api_sync_reintentar_errores() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform core.exigir('M01', 'admin_config');
  update core.sync_cola set intentos = 0, proximo_intento_en = null where estado = 'error';
  get diagnostics v_n = row_count;
  perform core.auditar('CORE', 'sync_reintentar_errores', 'sync_cola', null, jsonb_build_object('filas', v_n));
  return jsonb_build_object('filas', v_n);
end $$;

-- Vuelve a anotar TODO lo que hay en la base (por ejemplo, para llenar un libro nuevo de Google). Solo administrador general.
create function public.api_sync_reencolar_todo() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n bigint;
begin
  if not core.es_admin_general() then
    raise exception 'E_PERMISO|Solo el administrador general puede hacer esto.';
  end if;
  v_n := core.sync_encolar_todo();
  perform core.auditar('CORE', 'sync_reencolar_todo', 'sync_cola', null, jsonb_build_object('filas', v_n));
  return jsonb_build_object('filas', v_n);
end $$;

-- ---------------------------------------------------------------- 9) permisos de ejecución
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('sync_proximo_lote', 'sync_marcar_enviado', 'sync_marcar_error',
                                                  'api_sync_estado', 'api_sync_reintentar_errores', 'api_sync_reencolar_todo')
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

-- ---------------------------------------------------------------- 10) primera carga: todo lo que ya existe
select core.sync_encolar_todo();
