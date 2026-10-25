-- Prodmazul · Fase 4 · Parte 7 (ajustes) · Migración 8
-- 1) Cierre de lote: un lote puede llegar en varios camiones; al guardar y cerrar una recepción se indica si
--    ese era el último camión (el lote se cierra) o si faltan camiones (el lote sigue abierto).
--    Un lote cerrado no admite recepciones nuevas hasta que un administrador lo reabra.
-- 2) Las temperaturas ahora se asocian a GAVETAS (no a bines). Se pueden registrar hasta 30, una por gaveta.
--    La columna antigua «bines» se conserva (opcional) solo para no perder datos que pudieran existir.
-- Un proveedor puede tener varios lotes (otro día, o el mismo día con otro número de lote): ya era posible,
-- porque el proveedor se guarda por lote; se agregan pruebas que lo comprueban.

alter table core.lotes
  add column cerrado    boolean     not null default false,
  add column cerrado_en timestamptz,
  add column cerrado_por uuid;

alter table m01_recepcion.recepcion_temperaturas drop constraint recepcion_temperaturas_lectura_id_check;
alter table m01_recepcion.recepcion_temperaturas
  add constraint recepcion_temperaturas_lectura_id_check check (lectura_id between 1 and 30);
alter table m01_recepcion.recepcion_temperaturas add column num_gaveta smallint check (num_gaveta between 1 and 30);
alter table m01_recepcion.recepcion_temperaturas alter column bines drop not null;
alter table m01_recepcion.recepcion_temperaturas
  add constraint recepcion_temperaturas_ref_chk check (num_gaveta is not null or bines is not null);
create unique index recepcion_temperaturas_gaveta_uk
  on m01_recepcion.recepcion_temperaturas (recepcion_id, num_gaveta) where num_gaveta is not null;

-- ---------------------------------------------------------------- guardar
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
  v_cerrar_lote boolean := coalesce(p->>'cerrar_lote', 'false') in ('true', 't', '1');
  v_lote_cerrado boolean := false;
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

-- ---------------------------------------------------------------- obtener una recepción
create or replace function public.api_m01_obtener_recepcion(p_id text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_r jsonb;
begin
  perform core.exigir('M01', 'ver');
  select to_jsonb(r) || jsonb_build_object(
           'proveedor_nombre', pr.nombre,
           'lote_cerrado', (select lo.cerrado from core.lotes lo where lo.lote_id = r.lote_id),
           'especie_nombre', es.nombre,
           'realizado_por_nombre', pf.nombre,
           'gavetas', (select coalesce(jsonb_agg(jsonb_build_object('num_gaveta', g.num_gaveta, 'peso_lb', g.peso_lb)
                                                 order by g.num_gaveta), '[]'::jsonb)
                       from m01_recepcion.recepcion_gavetas g where g.recepcion_id = r.recepcion_id),
           'temperaturas', (select coalesce(jsonb_agg(jsonb_build_object('lectura_id', t.lectura_id, 'num_gaveta', t.num_gaveta, 'bines', t.bines,
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

-- ---------------------------------------------------------------- datos de un lote (ahora con estado)
create or replace function public.api_obtener_lote(p_lote text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_lote text;
  v_r    record;
  v_acum record;
begin
  perform core.exigir('M01', 'ver');
  v_lote := core.validar_lote(p_lote);
  select l.lote_id, l.cerrado, l.cerrado_en, p.nombre as proveedor_nombre, e.nombre as especie_nombre
    into v_r
  from core.lotes l
  join core.proveedores p on p.id = l.proveedor_id
  left join core.especies e on e.id = l.especie_id
  where l.lote_id = v_lote;
  if not found then
    return jsonb_build_object('existe', false, 'lote_id', v_lote, 'cerrado', false,
                              'camiones', 0, 'libras_reportadas', 0, 'libras_planta', 0);
  end if;
  select count(*) as camiones,
         coalesce(sum(libras_reportadas), 0) as reportadas,
         coalesce(sum(libras_planta), 0) as planta
    into v_acum
  from m01_recepcion.recepciones
  where lote_id = v_lote and estado in ('borrador', 'cerrado');
  return jsonb_build_object('existe', true, 'lote_id', v_r.lote_id, 'cerrado', v_r.cerrado, 'cerrado_en', v_r.cerrado_en,
                            'proveedor_nombre', v_r.proveedor_nombre, 'especie_nombre', v_r.especie_nombre,
                            'camiones', v_acum.camiones,
                            'libras_reportadas', v_acum.reportadas, 'libras_planta', v_acum.planta);
end $$;

-- ---------------------------------------------------------------- cerrar y reabrir un lote
create function public.api_m01_cerrar_lote(p_lote text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lote text;
begin
  perform core.exigir('M01', 'editar');
  v_lote := core.validar_lote(p_lote);
  update core.lotes set cerrado = true, cerrado_en = now(), cerrado_por = auth.uid()
  where lote_id = v_lote and not cerrado;
  if not found then
    if not exists (select 1 from core.lotes where lote_id = v_lote) then
      raise exception 'E_NO_ENCONTRADO|El lote no existe.';
    end if;
    raise exception 'E_ESTADO|El lote ya está cerrado.';
  end if;
  perform core.auditar('M01', 'cerrar_lote', 'lote', v_lote, '{}'::jsonb);
  return jsonb_build_object('lote_id', v_lote, 'cerrado', true);
end $$;

create function public.api_m01_reabrir_lote(p_lote text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lote text;
begin
  perform core.exigir('M01', 'eliminar');
  v_lote := core.validar_lote(p_lote);
  update core.lotes set cerrado = false, cerrado_en = null, cerrado_por = null
  where lote_id = v_lote and cerrado;
  if not found then
    if not exists (select 1 from core.lotes where lote_id = v_lote) then
      raise exception 'E_NO_ENCONTRADO|El lote no existe.';
    end if;
    raise exception 'E_ESTADO|El lote ya está abierto.';
  end if;
  perform core.auditar('M01', 'reabrir_lote', 'lote', v_lote, '{}'::jsonb);
  return jsonb_build_object('lote_id', v_lote, 'cerrado', false);
end $$;



do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('api_m01_guardar_recepcion', 'api_m01_obtener_recepcion',
          'api_obtener_lote', 'api_m01_cerrar_lote', 'api_m01_reabrir_lote')
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;
