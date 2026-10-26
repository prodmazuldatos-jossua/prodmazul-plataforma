-- Prodmazul · Fase 4 · Ajustes · Migración 12
-- 1) Las libras reportadas y las de planta no pueden ser menores que el peso total de las gavetas (se valida en la base).
-- 2) Las temperaturas se guardan siempre con 1 decimal (por ejemplo -3.0), tanto de gavetas como de bines.
-- 3) Devolver una recepción CERRADA a BORRADOR (con motivo): api_m01_devolver_a_borrador.
-- 4) Exportación completa a Excel: api_m01_exportar (el archivo se arma en la aplicación).
-- 5) Administración de usuarios: listar y actualizar (api_admin_*) y registrar (adm_registrar_usuario, solo la función de servidor).
--    Crear usuarios y cambiar contraseñas lo hace la función admin-usuarios (supabase/functions/admin-usuarios).

-- ---------------------------------------------------------------- 1) y 2) guardar recepción
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
  v_total_g numeric;
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
  -- Las libras reportadas y las de planta no pueden ser menores que el peso total de las gavetas registradas.
  select coalesce(sum(round((x->>'peso_lb')::numeric, 2)), 0) into v_total_g
  from jsonb_array_elements(coalesce(p->'gavetas', '[]'::jsonb)) x;
  if v_lrep is not null and v_lrep < v_total_g then
    raise exception 'E_VALIDACION|Las libras reportadas (%) no pueden ser menores que el peso total de las gavetas (%).', v_lrep, v_total_g;
  end if;
  if v_lpla is not null and v_lpla < v_total_g then
    raise exception 'E_VALIDACION|Las libras de planta (%) no pueden ser menores que el peso total de las gavetas (%).', v_lpla, v_total_g;
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
              round(nullif(btrim(coalesce(a->>'temperatura_c', '')), '')::numeric, 1),
              nullif(btrim(coalesce(a->>'libras_aprox', '')), '')::numeric);
    end loop;
    for t in select * from jsonb_array_elements(coalesce(p->'temperaturas', '[]'::jsonb)) loop
      insert into m01_recepcion.recepcion_temperaturas (recepcion_id, lectura_id, num_gaveta, temperatura_c)
      values (v_id, (t->>'lectura_id')::smallint, (t->>'num_gaveta')::smallint, round((t->>'temperatura_c')::numeric, 1));
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

-- Las temperaturas ya guardadas quedan con un solo decimal (no cambia ningún valor: las columnas ya son numeric(5,1)).

-- ---------------------------------------------------------------- 3) devolver a borrador
create function public.api_m01_devolver_a_borrador(p_id text, p_motivo text, p_version integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_r      m01_recepcion.recepciones;
begin
  perform core.exigir('M01', 'editar');
  v_r := m01_recepcion.cargar_para_cambio(p_id, p_version);
  if v_r.estado <> 'cerrado' then
    raise exception 'E_ESTADO|Solo se puede devolver a borrador una recepción cerrada.';
  end if;
  if v_r.creado_por is distinct from v_uid and not core.tiene_permiso('M01', 'eliminar') then
    raise exception 'E_PERMISO|Solo quien creó la recepción (o un administrador) puede devolverla a borrador.';
  end if;
  if char_length(v_motivo) < 5 then
    raise exception 'E_VALIDACION|El motivo debe tener al menos 5 caracteres.';
  end if;
  if char_length(v_motivo) > 500 then
    raise exception 'E_VALIDACION|El motivo no puede superar los 500 caracteres.';
  end if;

  update m01_recepcion.recepciones set
    estado = 'borrador', version = version + 1, modificado_en = now(), modificado_por = v_uid
  where recepcion_id = p_id;

  perform core.auditar('M01', 'devolver_a_borrador', 'recepcion', p_id, jsonb_build_object('motivo', v_motivo));
  return jsonb_build_object('recepcion_id', p_id, 'estado', 'borrador', 'version', v_r.version + 1);
end $$;

-- ---------------------------------------------------------------- 4) exportación a Excel
-- Devuelve TODAS las columnas guardadas de cada recepción y sus tablas hijas. Los pesos van en libras (como se guardan).
-- Las recepciones eliminadas solo las ve quien tiene el permiso «eliminar».
create function public.api_m01_exportar()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ver_eliminadas boolean;
  v_ids text[];
begin
  perform core.exigir('M01', 'ver_reportes');
  v_ver_eliminadas := core.tiene_permiso('M01', 'eliminar');
  select coalesce(array_agg(recepcion_id), '{}') into v_ids
  from m01_recepcion.recepciones where v_ver_eliminadas or estado <> 'eliminado';

  perform core.auditar('M01', 'exportar_excel', 'recepcion', null, jsonb_build_object('recepciones', cardinality(v_ids)));

  return jsonb_build_object(
    'generado_en', now(),
    'recepciones', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.fecha_llegada desc, x.recepcion_id desc), '[]'::jsonb)
      from (
        select r.recepcion_id, r.estado, r.estado_previo, r.version, r.fecha_llegada, r.placa_vehiculo, r.lote_id,
               l.cerrado as lote_cerrado, pr.nombre as proveedor, es.nombre as especie, r.piscina, r.guia_remision,
               r.llegada_en, r.num_gavetas_bines, r.libras_reportadas, r.libras_planta, r.diferencia_lb, r.diferencia_pct,
               r.peso_promedio_lb, r.hora_inicio_descarga, r.hora_fin_descarga, r.duracion_descarga_min, r.observacion,
               (select count(*) from m01_recepcion.recepcion_gavetas g where g.recepcion_id = r.recepcion_id) as gavetas_pesadas,
               (select coalesce(sum(g.peso_lb), 0) from m01_recepcion.recepcion_gavetas g where g.recepcion_id = r.recepcion_id) as peso_total_gavetas_lb,
               (select count(*) from m01_recepcion.recepcion_temperaturas t where t.recepcion_id = r.recepcion_id) as lecturas_temperatura,
               (select count(*) from m01_recepcion.recepcion_almacenamiento a where a.recepcion_id = r.recepcion_id) as bines_almacenamiento,
               (select count(*) from m01_recepcion.fotos_meta f where f.recepcion_id = r.recepcion_id) as fotos,
               coalesce(nullif(pe.nombre, ''), pe.correo) as realizado_por, pe.correo as realizado_por_correo, coalesce(nullif(pv.nombre, ''), pv.correo) as revisado_por,
               r.motivo_anulacion, r.anulado_en, coalesce(nullif(pa.nombre, ''), pa.correo) as anulado_por, r.eliminado_en, coalesce(nullif(pd.nombre, ''), pd.correo) as eliminado_por,
               r.creado_en, coalesce(nullif(pc.nombre, ''), pc.correo) as creado_por, r.modificado_en, coalesce(nullif(pm.nombre, ''), pm.correo) as modificado_por, r.client_uuid
        from m01_recepcion.recepciones r
        join core.proveedores pr on pr.id = r.proveedor_id
        join core.especies es on es.id = r.especie_id
        join core.lotes l on l.lote_id = r.lote_id
        left join core.perfiles pe on pe.user_id = r.realizado_por
        left join core.perfiles pv on pv.user_id = r.revisado_por
        left join core.perfiles pa on pa.user_id = r.anulado_por
        left join core.perfiles pd on pd.user_id = r.eliminado_por
        left join core.perfiles pc on pc.user_id = r.creado_por
        left join core.perfiles pm on pm.user_id = r.modificado_por
        where r.recepcion_id = any (v_ids)
      ) x),
    'gavetas', (
      select coalesce(jsonb_agg(to_jsonb(g) order by g.recepcion_id desc, g.num_gaveta), '[]'::jsonb)
      from m01_recepcion.recepcion_gavetas g where g.recepcion_id = any (v_ids)),
    'temperaturas', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.recepcion_id desc, t.num_gaveta, t.lectura_id), '[]'::jsonb)
      from m01_recepcion.recepcion_temperaturas t where t.recepcion_id = any (v_ids)),
    'almacenamiento', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.recepcion_id desc, a.num_bin), '[]'::jsonb)
      from m01_recepcion.recepcion_almacenamiento a where a.recepcion_id = any (v_ids)),
    'fotos', (
      select coalesce(jsonb_agg(jsonb_build_object('recepcion_id', f.recepcion_id, 'nn', f.nn, 'foto_id', f.foto_id, 'nombre', f.nombre,
               'tipo_mime', f.tipo_mime, 'tamano_bytes', f.tamano_bytes, 'subido_en', f.subido_en, 'confirmada', f.confirmada,
               'respaldo_drive_en', f.respaldo_drive_en) order by f.recepcion_id desc, f.nn), '[]'::jsonb)
      from m01_recepcion.fotos_meta f where f.recepcion_id = any (v_ids))
  );
end $$;

-- ---------------------------------------------------------------- 5) administración de usuarios
create function core.es_admin_general() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from core.perfiles where user_id = auth.uid() and activo and es_admin_general)
$$;

create function public.api_admin_listar_usuarios()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not core.es_admin_general() then
    raise exception 'E_PERMISO|Solo el administrador general puede ver los usuarios.';
  end if;
  return jsonb_build_object(
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('rol_id', rol_id, 'nombre', nombre) order by nombre), '[]'::jsonb) from core.roles),
    'modulos', (select coalesce(jsonb_agg(jsonb_build_object('modulo_id', modulo_id, 'nombre', nombre) order by orden), '[]'::jsonb) from core.modulos where habilitado),
    'usuarios', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', p.user_id, 'correo', p.correo, 'nombre', p.nombre, 'activo', p.activo, 'es_admin_general', p.es_admin_general,
        'creado_en', p.creado_en, 'ultimo_acceso', u.last_sign_in_at,
        'roles', (select coalesce(jsonb_agg(jsonb_build_object('modulo_id', r.modulo_id, 'rol_id', r.rol_id) order by r.modulo_id), '[]'::jsonb)
                  from core.usuario_modulo_rol r where r.user_id = p.user_id)
      ) order by p.es_admin_general desc, lower(p.nombre), lower(p.correo)), '[]'::jsonb)
      from core.perfiles p left join auth.users u on u.id = p.user_id));
end $$;

-- Aplica nombre, estado y roles a un usuario. Lo usan api_admin_actualizar_usuario y adm_registrar_usuario.
create function core.aplicar_datos_usuario(p_user uuid, p_nombre text, p_activo boolean, p_roles jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  r jsonb;
begin
  if v_nombre = '' or char_length(v_nombre) > 60 then
    raise exception 'E_VALIDACION|El nombre es obligatorio y debe tener hasta 60 caracteres.';
  end if;
  if jsonb_typeof(coalesce(p_roles, '[]'::jsonb)) <> 'array' then
    raise exception 'E_VALIDACION|Los roles no son válidos.';
  end if;
  update core.perfiles set nombre = v_nombre, activo = coalesce(p_activo, activo) where user_id = p_user;
  if not found then
    raise exception 'E_NO_ENCONTRADO|El usuario no existe.';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_roles, '[]'::jsonb)) loop
    if nullif(btrim(coalesce(r->>'rol_id', '')), '') is null then
      delete from core.usuario_modulo_rol where user_id = p_user and modulo_id = r->>'modulo_id';
    else
      if not exists (select 1 from core.modulos where modulo_id = r->>'modulo_id' and habilitado)
         or not exists (select 1 from core.roles where rol_id = r->>'rol_id') then
        raise exception 'E_VALIDACION|El módulo o el rol no existen.';
      end if;
      insert into core.usuario_modulo_rol (user_id, modulo_id, rol_id) values (p_user, r->>'modulo_id', r->>'rol_id')
      on conflict (user_id, modulo_id) do update set rol_id = excluded.rol_id;
    end if;
  end loop;
end $$;

create function public.api_admin_actualizar_usuario(p_user uuid, p_nombre text, p_activo boolean, p_roles jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_p core.perfiles;
begin
  if not core.es_admin_general() then
    raise exception 'E_PERMISO|Solo el administrador general puede modificar usuarios.';
  end if;
  select * into v_p from core.perfiles where user_id = p_user;
  if not found then
    raise exception 'E_NO_ENCONTRADO|El usuario no existe.';
  end if;
  if v_p.es_admin_general and coalesce(p_activo, true) = false then
    raise exception 'E_ESTADO|No se puede desactivar a un administrador general.';
  end if;
  if v_p.es_admin_general and jsonb_array_length(coalesce(p_roles, '[]'::jsonb)) > 0 then
    raise exception 'E_ESTADO|Un administrador general ya tiene todos los permisos: no se le asignan roles.';
  end if;
  perform core.aplicar_datos_usuario(p_user, p_nombre, p_activo, p_roles);
  perform core.auditar('CORE', 'actualizar_usuario', 'usuario', p_user::text,
                       jsonb_build_object('nombre', btrim(p_nombre), 'activo', p_activo, 'roles', coalesce(p_roles, '[]'::jsonb)));
  return jsonb_build_object('user_id', p_user, 'ok', true);
end $$;

-- Solo la función de servidor admin-usuarios (clave de servicio) la llama, después de crear la cuenta en Auth.
create function public.adm_registrar_usuario(p_user uuid, p_nombre text, p_roles jsonb, p_admin uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform core.aplicar_datos_usuario(p_user, p_nombre, true, p_roles);
  insert into core.auditoria (user_id, modulo_id, accion, entidad, entidad_id, detalle)
  values (p_admin, 'CORE', 'crear_usuario', 'usuario', p_user::text, jsonb_build_object('nombre', btrim(p_nombre), 'roles', coalesce(p_roles, '[]'::jsonb)));
  return jsonb_build_object('user_id', p_user, 'ok', true);
end $$;

-- Para registrar en la auditoría un cambio de contraseña hecho por el administrador.
create function public.adm_auditar_clave(p_user uuid, p_admin uuid)
returns void
language sql security definer set search_path = '' as $$
  insert into core.auditoria (user_id, modulo_id, accion, entidad, entidad_id)
  values (p_admin, 'CORE', 'cambiar_clave_usuario', 'usuario', p_user::text)
$$;

-- Permisos: las api_* las ejecuta cualquier sesión (cada una valida su permiso); las adm_* solo el servidor.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('api_m01_devolver_a_borrador', 'api_m01_exportar', 'api_admin_listar_usuarios',
                                                  'api_admin_actualizar_usuario', 'adm_registrar_usuario', 'adm_auditar_clave')
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
