-- Prodmazul · Fase 4 · Parte 4 · Migración 5: guardar y consultar recepciones (API del módulo 1)
-- La aplicación solo llama a funciones public.api_*. Cada una valida el permiso dentro de la base de datos.
-- Errores de negocio: 'E_CODIGO|Mensaje en español'.
-- Pesos siempre en LIBRAS.

-- ---------------------------------------------------------------- catálogo (autocompletar)
create function public.api_listar_catalogo(p_tipo text, p_busqueda text default '')
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_b text := core.normalizar(p_busqueda);
  v_r jsonb;
begin
  perform core.exigir('M01', 'ver');
  if p_tipo = 'proveedores' then
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre), '[]'::jsonb) into v_r
    from (select id, nombre from core.proveedores
          where activo and (v_b = '' or nombre_normalizado like '%' || v_b || '%')
          order by nombre limit 20) x;
  elsif p_tipo = 'especies' then
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre), '[]'::jsonb) into v_r
    from (select id, nombre from core.especies
          where activo and (v_b = '' or nombre_normalizado like '%' || v_b || '%')
          order by nombre limit 20) x;
  elsif p_tipo = 'lotes' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'lote_id', lote_id, 'proveedor_nombre', proveedor_nombre, 'especie_nombre', especie_nombre)
             order by lote_id), '[]'::jsonb) into v_r
    from (select l.lote_id, p.nombre as proveedor_nombre, e.nombre as especie_nombre
          from core.lotes l
          join core.proveedores p on p.id = l.proveedor_id
          left join core.especies e on e.id = l.especie_id
          where l.activo and (v_b = '' or l.lote_id like '%' || v_b || '%')
          order by l.lote_id limit 20) x;
  else
    raise exception 'E_VALIDACION|Tipo de catálogo no válido.';
  end if;
  return v_r;
end $$;

-- ---------------------------------------------------------------- datos de un lote
-- Sirve para completar proveedor y especie al escribir un lote que ya existe.
create function public.api_obtener_lote(p_lote text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_lote text;
  v_r    record;
begin
  perform core.exigir('M01', 'ver');
  v_lote := core.validar_lote(p_lote);
  select l.lote_id, p.nombre as proveedor_nombre, e.nombre as especie_nombre
    into v_r
  from core.lotes l
  join core.proveedores p on p.id = l.proveedor_id
  left join core.especies e on e.id = l.especie_id
  where l.lote_id = v_lote;
  if not found then
    return jsonb_build_object('existe', false, 'lote_id', v_lote);
  end if;
  return jsonb_build_object('existe', true, 'lote_id', v_r.lote_id,
                            'proveedor_nombre', v_r.proveedor_nombre, 'especie_nombre', v_r.especie_nombre);
end $$;

-- ---------------------------------------------------------------- obtener una recepción completa
create function public.api_m01_obtener_recepcion(p_id text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_r jsonb;
begin
  perform core.exigir('M01', 'ver');
  select to_jsonb(r) || jsonb_build_object(
           'proveedor_nombre', pr.nombre,
           'especie_nombre', es.nombre,
           'realizado_por_nombre', pf.nombre,
           'gavetas', (select coalesce(jsonb_agg(jsonb_build_object('num_gaveta', g.num_gaveta, 'peso_lb', g.peso_lb)
                                                 order by g.num_gaveta), '[]'::jsonb)
                       from m01_recepcion.recepcion_gavetas g where g.recepcion_id = r.recepcion_id),
           'temperaturas', (select coalesce(jsonb_agg(jsonb_build_object('lectura_id', t.lectura_id, 'bines', t.bines,
                                                                          'temperatura_c', t.temperatura_c)
                                                      order by t.lectura_id), '[]'::jsonb)
                            from m01_recepcion.recepcion_temperaturas t where t.recepcion_id = r.recepcion_id),
           'almacenamiento', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'num_bin', a.num_bin, 'sellos_recepcion', a.sellos_recepcion,
                                 'sellos_almacenamiento', a.sellos_almacenamiento,
                                 'temperatura_c', a.temperatura_c, 'libras_aprox', a.libras_aprox)
                                 order by a.num_bin), '[]'::jsonb)
                              from m01_recepcion.recepcion_almacenamiento a where a.recepcion_id = r.recepcion_id),
           'fotos', (select coalesce(jsonb_agg(jsonb_build_object(
                        'foto_id', f.foto_id, 'nn', f.nn, 'nombre', f.nombre, 'tipo_mime', f.tipo_mime,
                        'tamano_bytes', f.tamano_bytes) order by f.nn), '[]'::jsonb)
                     from m01_recepcion.fotos_meta f where f.recepcion_id = r.recepcion_id and f.confirmada))
    into v_r
  from m01_recepcion.recepciones r
  join core.proveedores pr on pr.id = r.proveedor_id
  join core.especies es on es.id = r.especie_id
  left join core.perfiles pf on pf.user_id = r.realizado_por
  where r.recepcion_id = p_id
    and (r.estado <> 'eliminado' or core.tiene_permiso('M01', 'eliminar'));
  if v_r is null then
    raise exception 'E_NO_ENCONTRADO|La recepción no existe.';
  end if;
  return v_r;
end $$;

-- ---------------------------------------------------------------- listar recepciones
-- p: { busqueda, estado ('activos' | 'todos' | 'borrador' | 'cerrado' | 'anulado' | 'eliminado'),
--      desde, hasta, limite (máx. 100), desplazamiento }
create function public.api_m01_listar_recepciones(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_b      text := core.normalizar(p->>'busqueda');
  v_estado text := coalesce(nullif(btrim(p->>'estado'), ''), 'activos');
  v_desde  date;
  v_hasta  date;
  v_lim    integer;
  v_off    integer;
  v_elim   boolean;
  v_total  integer;
  v_items  jsonb;
begin
  perform core.exigir('M01', 'ver');
  v_desde := nullif(btrim(coalesce(p->>'desde', '')), '')::date;
  v_hasta := nullif(btrim(coalesce(p->>'hasta', '')), '')::date;
  v_lim   := least(greatest(coalesce(nullif(p->>'limite', '')::integer, 20), 1), 100);
  v_off   := greatest(coalesce(nullif(p->>'desplazamiento', '')::integer, 0), 0);
  v_elim := core.tiene_permiso('M01', 'eliminar');
  if v_estado not in ('activos', 'todos', 'borrador', 'cerrado', 'anulado', 'eliminado') then
    raise exception 'E_VALIDACION|Estado de filtro no válido.';
  end if;
  if v_estado = 'eliminado' and not v_elim then
    raise exception 'E_PERMISO|No tienes permiso para ver recepciones eliminadas.';
  end if;

  with f as (
    select r.*, pr.nombre as proveedor_nombre, es.nombre as especie_nombre, pf.nombre as realizado_por_nombre
    from m01_recepcion.recepciones r
    join core.proveedores pr on pr.id = r.proveedor_id
    join core.especies es on es.id = r.especie_id
    left join core.perfiles pf on pf.user_id = r.realizado_por
    where (case v_estado
             when 'activos'  then r.estado in ('borrador', 'cerrado')
             when 'todos'    then r.estado in ('borrador', 'cerrado', 'anulado') or (v_elim and r.estado = 'eliminado')
             else r.estado = v_estado end)
      and (v_desde is null or r.fecha_llegada >= v_desde)
      and (v_hasta is null or r.fecha_llegada <= v_hasta)
      and (v_b = '' or core.normalizar(
             r.recepcion_id || ' ' || r.guia_remision || ' ' || r.lote_id || ' ' || coalesce(r.placa_vehiculo, '')
             || ' ' || pr.nombre || ' ' || es.nombre) like '%' || v_b || '%')
  ), pagina as (
    select * from f order by fecha_llegada desc, recepcion_id desc limit v_lim offset v_off
  )
  select (select count(*) from f),
         coalesce((select jsonb_agg(jsonb_build_object(
           'recepcion_id', x.recepcion_id, 'fecha_llegada', x.fecha_llegada, 'lote_id', x.lote_id,
           'proveedor_nombre', x.proveedor_nombre, 'especie_nombre', x.especie_nombre,
           'guia_remision', x.guia_remision, 'placa_vehiculo', x.placa_vehiculo,
           'num_gavetas_bines', x.num_gavetas_bines,
           'libras_reportadas', x.libras_reportadas, 'libras_planta', x.libras_planta,
           'diferencia_lb', x.diferencia_lb, 'diferencia_pct', x.diferencia_pct,
           'estado', x.estado, 'version', x.version, 'realizado_por_nombre', x.realizado_por_nombre,
           'modificado_en', x.modificado_en) order by x.fecha_llegada desc, x.recepcion_id desc)
           from pagina x), '[]'::jsonb)
    into v_total, v_items;

  return jsonb_build_object('total', v_total, 'items', v_items);
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
       or numeric_value_out_of_range or invalid_parameter_value then
    raise exception 'E_VALIDACION|Alguno de los filtros tiene un valor no válido.';
end $$;

-- ---------------------------------------------------------------- guardar (crear o editar)
-- p: { recepcion_id (solo al editar), client_uuid, version (solo al editar), estado ('borrador'|'cerrado'),
--      fecha_llegada, placa_vehiculo, lote_id, proveedor (nombre; solo si el lote es nuevo), especie (nombre),
--      piscina, guia_remision, num_gavetas_bines, libras_reportadas, libras_planta,
--      hora_inicio_descarga, hora_fin_descarga, observacion,
--      gavetas:[{num_gaveta,peso_lb}], temperaturas:[{lectura_id,bines,temperatura_c}],
--      almacenamiento:[{num_bin,sellos_recepcion,sellos_almacenamiento,temperatura_c,libras_aprox}] }
-- Devuelve { recepcion_id, version, estado, duplicado }.
create function public.api_m01_guardar_recepcion(p jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_uuid    uuid;
  v_estado  text := coalesce(nullif(btrim(p->>'estado'), ''), 'borrador');
  v_id      text := nullif(btrim(coalesce(p->>'recepcion_id', '')), '');
  v_fecha   date;
  v_lote    text;
  v_guia    text;
  v_ngb     integer;
  v_lrep    numeric;
  v_lpla    numeric;
  v_hi      time;
  v_hf      time;
  v_obs     text;
  v_prov    uuid;
  v_esp     uuid;
  v_lote_r  core.lotes;
  v_actual  m01_recepcion.recepciones;
  v_prom    numeric;
  v_nueva   boolean := (v_id is null);
  v_cons    text;
  v_ya      m01_recepcion.recepciones;
  g jsonb; t jsonb; a jsonb;
begin
  perform core.exigir('M01', 'ver');
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'E_VALIDACION|Los datos de la recepción no son válidos.';
  end if;
  if v_estado not in ('borrador', 'cerrado') then
    raise exception 'E_VALIDACION|El estado debe ser borrador o cerrado.';
  end if;

  begin
    v_uuid := (p->>'client_uuid')::uuid;
  exception when invalid_text_representation then
    v_uuid := null;
  end;
  if v_uuid is null then
    raise exception 'E_VALIDACION|Falta el identificador único del envío (client_uuid).';
  end if;

  -- Reintentos: si ese envío ya se guardó, se devuelve lo guardado sin duplicar.
  if v_nueva then
    perform core.exigir('M01', 'crear');
    select * into v_ya from m01_recepcion.recepciones where client_uuid = v_uuid;
    if found then
      return jsonb_build_object('recepcion_id', v_ya.recepcion_id, 'version', v_ya.version,
                                'estado', v_ya.estado, 'duplicado', true);
    end if;
  else
    perform core.exigir('M01', 'editar');
    select * into v_actual from m01_recepcion.recepciones where recepcion_id = v_id for update;
    if not found or v_actual.estado = 'eliminado' then
      raise exception 'E_NO_ENCONTRADO|La recepción no existe.';
    end if;
    if v_actual.estado not in ('borrador', 'cerrado') then
      raise exception 'E_ESTADO|Una recepción anulada no se puede editar.';
    end if;
    if coalesce(nullif(p->>'version', ''), '-1')::integer <> v_actual.version then
      raise exception 'E_VERSION|La recepción fue modificada por otra persona. Vuelve a abrirla para ver los cambios.';
    end if;
    if v_actual.creado_por is distinct from v_uid and not core.tiene_permiso('M01', 'eliminar') then
      raise exception 'E_PERMISO|Solo quien creó la recepción (o un administrador) puede editarla.';
    end if;
  end if;

  -- Validaciones de campos
  v_fecha := nullif(btrim(coalesce(p->>'fecha_llegada', '')), '')::date;
  if v_fecha is null then
    raise exception 'E_VALIDACION|La fecha de llegada es obligatoria.';
  end if;
  if v_fecha > (now() at time zone 'America/Guayaquil')::date then
    raise exception 'E_VALIDACION|La fecha de llegada no puede ser futura.';
  end if;
  v_guia := nullif(btrim(coalesce(p->>'guia_remision', '')), '');
  if v_guia is null then
    raise exception 'E_VALIDACION|La guía de remisión es obligatoria.';
  end if;
  v_ngb := nullif(btrim(coalesce(p->>'num_gavetas_bines', '')), '')::integer;
  if v_ngb is null or v_ngb < 1 then
    raise exception 'E_VALIDACION|El número de gavetas o bines debe ser al menos 1.';
  end if;
  v_lrep := nullif(btrim(coalesce(p->>'libras_reportadas', '')), '')::numeric;
  v_lpla := nullif(btrim(coalesce(p->>'libras_planta', '')), '')::numeric;
  v_hi   := nullif(btrim(coalesce(p->>'hora_inicio_descarga', '')), '')::time;
  v_hf   := nullif(btrim(coalesce(p->>'hora_fin_descarga', '')), '')::time;
  v_obs  := nullif(btrim(coalesce(p->>'observacion', '')), '');
  if v_hi is not null and v_hf is not null and v_hf < v_hi then
    raise exception 'E_VALIDACION|La hora de fin de descarga no puede ser anterior a la de inicio.';
  end if;
  if coalesce(jsonb_typeof(p->'gavetas'), 'array') <> 'array'
     or coalesce(jsonb_typeof(p->'temperaturas'), 'array') <> 'array'
     or coalesce(jsonb_typeof(p->'almacenamiento'), 'array') <> 'array' then
    raise exception 'E_VALIDACION|Las listas de gavetas, temperaturas y almacenamiento no son válidas.';
  end if;
  if v_estado = 'cerrado' then
    if v_lrep is null or v_lpla is null then
      raise exception 'E_VALIDACION|Para cerrar la recepción indica las libras reportadas y las libras de planta.';
    end if;
    if jsonb_array_length(coalesce(p->'gavetas', '[]'::jsonb)) = 0 then
      raise exception 'E_VALIDACION|Para cerrar la recepción registra el peso de al menos una gaveta.';
    end if;
  end if;

  -- Lote, proveedor y especie
  v_lote := core.validar_lote(p->>'lote_id');
  select * into v_lote_r from core.lotes where lote_id = v_lote;
  if found then
    v_prov := v_lote_r.proveedor_id;
    if nullif(btrim(coalesce(p->>'especie', '')), '') is not null then
      v_esp := core.obtener_o_crear_especie(p->>'especie');
    else
      v_esp := v_lote_r.especie_id;
    end if;
    if v_esp is null then
      raise exception 'E_VALIDACION|La especie es obligatoria.';
    end if;
    if v_lote_r.especie_id is null then
      update core.lotes set especie_id = v_esp where lote_id = v_lote;
    end if;
  else
    if nullif(btrim(coalesce(p->>'proveedor', '')), '') is null then
      raise exception 'E_VALIDACION|El proveedor es obligatorio cuando el lote es nuevo.';
    end if;
    if nullif(btrim(coalesce(p->>'especie', '')), '') is null then
      raise exception 'E_VALIDACION|La especie es obligatoria.';
    end if;
    v_prov := core.obtener_o_crear_proveedor(p->>'proveedor');
    v_esp  := core.obtener_o_crear_especie(p->>'especie');
    insert into core.lotes (lote_id, proveedor_id, especie_id, creado_por) values (v_lote, v_prov, v_esp, v_uid);
  end if;

  if not v_nueva and v_actual.lote_id <> v_lote
     and exists (select 1 from m01_recepcion.fotos_meta where recepcion_id = v_id) then
    raise exception 'E_VALIDACION|No se puede cambiar el lote de una recepción que ya tiene fotos.';
  end if;

  -- Las temperaturas deben corresponder a bines registrados en almacenamiento
  for t in select * from jsonb_array_elements(coalesce(p->'temperaturas', '[]'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(coalesce(p->'almacenamiento', '[]'::jsonb)) x
                   where btrim(x->>'num_bin') = btrim(t->>'bines')) then
      raise exception 'E_VALIDACION|La temperatura del bin "%" no corresponde a ningún bin de almacenamiento.', t->>'bines';
    end if;
  end loop;

  select round(avg((x->>'peso_lb')::numeric), 2) into v_prom
  from jsonb_array_elements(coalesce(p->'gavetas', '[]'::jsonb)) x;

  begin
    if v_nueva then
      v_id := m01_recepcion.siguiente_id(v_fecha);
      insert into m01_recepcion.recepciones (
        recepcion_id, client_uuid, fecha_llegada, placa_vehiculo, lote_id, proveedor_id, especie_id, piscina,
        guia_remision, num_gavetas_bines, libras_reportadas, libras_planta, peso_promedio_lb,
        hora_inicio_descarga, hora_fin_descarga, observacion, realizado_por, estado, creado_por, modificado_por)
      values (
        v_id, v_uuid, v_fecha, nullif(btrim(coalesce(p->>'placa_vehiculo', '')), ''), v_lote, v_prov, v_esp,
        nullif(btrim(coalesce(p->>'piscina', '')), ''), v_guia, v_ngb, v_lrep, v_lpla, v_prom,
        v_hi, v_hf, v_obs, v_uid, v_estado, v_uid, v_uid);
    else
      update m01_recepcion.recepciones set
        fecha_llegada = v_fecha, placa_vehiculo = nullif(btrim(coalesce(p->>'placa_vehiculo', '')), ''),
        lote_id = v_lote, proveedor_id = v_prov, especie_id = v_esp,
        piscina = nullif(btrim(coalesce(p->>'piscina', '')), ''), guia_remision = v_guia,
        num_gavetas_bines = v_ngb, libras_reportadas = v_lrep, libras_planta = v_lpla, peso_promedio_lb = v_prom,
        hora_inicio_descarga = v_hi, hora_fin_descarga = v_hf, observacion = v_obs, estado = v_estado,
        version = version + 1, modificado_en = now(), modificado_por = v_uid
      where recepcion_id = v_id;
      delete from m01_recepcion.recepcion_gavetas where recepcion_id = v_id;
      delete from m01_recepcion.recepcion_temperaturas where recepcion_id = v_id;
      delete from m01_recepcion.recepcion_almacenamiento where recepcion_id = v_id;
    end if;

    for g in select * from jsonb_array_elements(coalesce(p->'gavetas', '[]'::jsonb)) loop
      insert into m01_recepcion.recepcion_gavetas (recepcion_id, num_gaveta, peso_lb)
      values (v_id, (g->>'num_gaveta')::smallint, (g->>'peso_lb')::numeric);
    end loop;
    for a in select * from jsonb_array_elements(coalesce(p->'almacenamiento', '[]'::jsonb)) loop
      insert into m01_recepcion.recepcion_almacenamiento
        (recepcion_id, num_bin, sellos_recepcion, sellos_almacenamiento, temperatura_c, libras_aprox)
      values (v_id, btrim(a->>'num_bin'), coalesce(btrim(a->>'sellos_recepcion'), ''),
              coalesce(btrim(a->>'sellos_almacenamiento'), ''),
              nullif(btrim(coalesce(a->>'temperatura_c', '')), '')::numeric,
              nullif(btrim(coalesce(a->>'libras_aprox', '')), '')::numeric);
    end loop;
    for t in select * from jsonb_array_elements(coalesce(p->'temperaturas', '[]'::jsonb)) loop
      insert into m01_recepcion.recepcion_temperaturas (recepcion_id, lectura_id, bines, temperatura_c)
      values (v_id, (t->>'lectura_id')::smallint, btrim(t->>'bines'), (t->>'temperatura_c')::numeric);
    end loop;
  exception
    when unique_violation then
      get stacked diagnostics v_cons = constraint_name;
      if v_cons = 'recepciones_client_uuid_key' then
        select * into v_ya from m01_recepcion.recepciones where client_uuid = v_uuid;
        return jsonb_build_object('recepcion_id', v_ya.recepcion_id, 'version', v_ya.version,
                                  'estado', v_ya.estado, 'duplicado', true);
      elsif v_cons = 'recepciones_guia_key' then
        raise exception 'E_DUPLICADO|Ya existe una recepción con la guía de remisión "%".', v_guia;
      elsif v_cons like 'almacenamiento_sello%' then
        raise exception 'E_DUPLICADO|Hay sellos repetidos entre los bines de esta recepción.';
      else
        raise exception 'E_DUPLICADO|Hay números de gaveta, bin o lectura repetidos.';
      end if;
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
         or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
      raise exception 'E_VALIDACION|Alguno de los valores no es válido (revisa pesos, temperaturas, horas y números).';
  end;

  perform core.auditar('M01', case when v_nueva then 'crear' else 'editar' end, 'recepcion', v_id,
                       jsonb_build_object('estado', v_estado, 'lote_id', v_lote, 'guia_remision', v_guia));

  return jsonb_build_object('recepcion_id', v_id,
                            'version', case when v_nueva then 1 else v_actual.version + 1 end,
                            'estado', v_estado, 'duplicado', false);
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
       or numeric_value_out_of_range then
    raise exception 'E_VALIDACION|Alguno de los valores no es válido (revisa fecha, horas, pesos y números).';
end $$;

-- Solo usuarios con sesión (authenticated) ejecutan las funciones api_*.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'api\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;
