-- Prodmazul · Fase 4 · Parte 7 (ajustes 2) · Migración 9
-- 1) El producto puede llegar en BINES (por defecto) o en GAVETAS: se guarda en recepciones.llegada_en
--    (el parámetro llegada_en de api_m01_guardar_recepcion; si no se envía, es 'bines').
--    El campo num_gavetas_bines conserva su nombre; ahora se interpreta según llegada_en.
-- 2) Nombre del usuario: core.perfiles.nombre ya existe; se agrega core.asignar_nombre_usuario(correo, nombre)
--    para asignarlo desde el SQL Editor. Ese nombre se muestra en «Hola, Nombre» y en «Realizado por» del PDF.

alter table m01_recepcion.recepciones
  add column llegada_en text not null default 'bines',
  add constraint recepciones_llegada_en_chk check (llegada_en in ('bines', 'gavetas'));

create function core.asignar_nombre_usuario(p_correo text, p_nombre text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_n integer;
begin
  if v_nombre = '' or char_length(v_nombre) > 60 then
    raise exception 'El nombre es obligatorio y debe tener hasta 60 caracteres.';
  end if;
  update core.perfiles set nombre = v_nombre where lower(correo) = lower(btrim(p_correo));
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'No existe un usuario con el correo %.', p_correo;
  end if;
  return v_nombre;
end $$;
revoke all on function core.asignar_nombre_usuario(text, text) from public, anon, authenticated;

create or replace function public.api_m01_guardar_recepcion(p jsonb)
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
  v_llegada text := coalesce(nullif(btrim(p->>'llegada_en'), ''), 'bines');
  v_cerrar_lote boolean := coalesce(p->>'cerrar_lote', 'false') in ('true', 't', '1');
  v_lote_cerrado boolean := false;
  g jsonb; t jsonb; a jsonb;
begin
  perform core.exigir('M01', 'ver');
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'E_VALIDACION|Los datos de la recepción no son válidos.';
  end if;
  if v_llegada not in ('bines', 'gavetas') then
    raise exception 'E_VALIDACION|Indica si el producto llegó en bines o en gavetas.';
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
    raise exception 'E_VALIDACION|El número de % debe ser al menos 1.', v_llegada;
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
    if v_lote_r.cerrado and (v_nueva or v_actual.lote_id <> v_lote) then
      raise exception 'E_ESTADO|El lote % ya está cerrado: no admite más camiones. Un administrador puede reabrirlo.', v_lote;
    end if;
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

  -- Las temperaturas son de gavetas registradas, una lectura por gaveta
  for t in select * from jsonb_array_elements(coalesce(p->'temperaturas', '[]'::jsonb)) loop
    if nullif(btrim(coalesce(t->>'num_gaveta', '')), '') is null
       or not exists (select 1 from jsonb_array_elements(coalesce(p->'gavetas', '[]'::jsonb)) x
                      where (x->>'num_gaveta')::integer = (t->>'num_gaveta')::integer) then
      raise exception 'E_VALIDACION|La temperatura de la gaveta "%" no corresponde a ninguna gaveta con peso registrado.', coalesce(t->>'num_gaveta', '?');
    end if;
  end loop;
  if (select count(*) <> count(distinct (x->>'num_gaveta')::integer)
        from jsonb_array_elements(coalesce(p->'temperaturas', '[]'::jsonb)) x) then
    raise exception 'E_VALIDACION|Una gaveta solo puede tener una temperatura.';
  end if;

  select round(avg((x->>'peso_lb')::numeric), 2) into v_prom
  from jsonb_array_elements(coalesce(p->'gavetas', '[]'::jsonb)) x;

  begin
    if v_nueva then
      v_id := m01_recepcion.siguiente_id(v_fecha);
      insert into m01_recepcion.recepciones (
        recepcion_id, client_uuid, fecha_llegada, placa_vehiculo, lote_id, proveedor_id, especie_id, piscina,
        guia_remision, num_gavetas_bines, llegada_en, libras_reportadas, libras_planta, peso_promedio_lb,
        hora_inicio_descarga, hora_fin_descarga, observacion, realizado_por, estado, creado_por, modificado_por)
      values (
        v_id, v_uuid, v_fecha, nullif(btrim(coalesce(p->>'placa_vehiculo', '')), ''), v_lote, v_prov, v_esp,
        nullif(btrim(coalesce(p->>'piscina', '')), ''), v_guia, v_ngb, v_llegada, v_lrep, v_lpla, v_prom,
        v_hi, v_hf, v_obs, v_uid, v_estado, v_uid, v_uid);
    else
      update m01_recepcion.recepciones set
        fecha_llegada = v_fecha, placa_vehiculo = nullif(btrim(coalesce(p->>'placa_vehiculo', '')), ''),
        lote_id = v_lote, proveedor_id = v_prov, especie_id = v_esp,
        piscina = nullif(btrim(coalesce(p->>'piscina', '')), ''), guia_remision = v_guia,
        num_gavetas_bines = v_ngb, llegada_en = v_llegada, libras_reportadas = v_lrep, libras_planta = v_lpla, peso_promedio_lb = v_prom,
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
      insert into m01_recepcion.recepcion_temperaturas (recepcion_id, lectura_id, num_gaveta, temperatura_c)
      values (v_id, (t->>'lectura_id')::smallint, (t->>'num_gaveta')::smallint, (t->>'temperatura_c')::numeric);
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

  if v_cerrar_lote and v_estado = 'cerrado' then
    update core.lotes set cerrado = true, cerrado_en = now(), cerrado_por = v_uid
    where lote_id = v_lote and not cerrado;
    if found then
      perform core.auditar('M01', 'cerrar_lote', 'lote', v_lote, jsonb_build_object('recepcion_id', v_id));
    end if;
  end if;
  select cerrado into v_lote_cerrado from core.lotes where lote_id = v_lote;

  perform core.auditar('M01', case when v_nueva then 'crear' else 'editar' end, 'recepcion', v_id,
                       jsonb_build_object('estado', v_estado, 'lote_id', v_lote, 'guia_remision', v_guia));

  return jsonb_build_object('recepcion_id', v_id,
                            'version', case when v_nueva then 1 else v_actual.version + 1 end,
                            'estado', v_estado, 'duplicado', false, 'lote_cerrado', v_lote_cerrado);
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
       or numeric_value_out_of_range then
    raise exception 'E_VALIDACION|Alguno de los valores no es válido (revisa fecha, horas, pesos y números).';
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'api_m01_guardar_recepcion'
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;
