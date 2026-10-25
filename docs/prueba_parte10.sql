-- Prodmazul · Fase 4 · Parte 10 · Prueba del reenvío sin duplicados EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Comprueba lo que usa el modo sin conexión: reenviar la misma recepción (mismo client_uuid) NO la duplica, una
-- recepción rechazada por guía repetida se puede corregir con el mismo identificador, y la auditoría no se duplica.
-- Al final se detiene a propósito con un mensaje de error que contiene el resultado, y por eso NO queda ningún dato guardado.
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA PARTE 10: 9 correctas, 0 con fallo.»
-- Ese «error» es normal: es la forma de deshacer los datos de prueba.

do $prueba$
declare
  v_admin uuid;
  v_ok    integer := 0;
  v_mal   integer := 0;
  v_txt   text := '';
  v_e     text;
  v_r     jsonb;
  v_r2    jsonb;
  v_n     integer;
  v_u1    uuid := gen_random_uuid();
  v_u2    uuid := gen_random_uuid();
  v_hoy   date := (now() at time zone 'America/Guayaquil')::date;
  v_base  jsonb;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;
  v_base := jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '991-991-991', 'llegada_en', 'bines',
    'proveedor', 'ZZ P10 PROVEEDOR', 'especie', 'ZZ P10 ESPECIE', 'num_gavetas_bines', 4,
    'libras_reportadas', 100, 'libras_planta', 98, 'guia_remision', 'ZZ-P10-A',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',50)),
    'temperaturas', jsonb_build_array());

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  -- 1) primer envío
  v_r := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', v_u1));
  v_e := null;
  if (v_r->>'duplicado')::boolean = false and v_r->>'recepcion_id' like 'REC-%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el primer envío crea la recepción ' || v_r::text; end if;

  -- 2) reenvío del mismo identificador (como si se hubiera perdido la respuesta)
  v_r2 := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', v_u1));
  if (v_r2->>'duplicado')::boolean = true and v_r2->>'recepcion_id' = v_r->>'recepcion_id' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reenviar devuelve la misma recepción marcada como duplicado ' || v_r2::text; end if;

  -- 3) y solo hay una
  reset role;
  select count(*) into v_n from m01_recepcion.recepciones where client_uuid = v_u1;
  if v_n = 1 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: queda UNA sola recepción (hay ' || v_n || ')'; end if;
  select count(*) into v_n from m01_recepcion.recepciones where guia_remision = 'ZZ-P10-A';
  if v_n = 1 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una sola con esa guía (hay ' || v_n || ')'; end if;
  select count(*) into v_n from core.auditoria where entidad_id = v_r->>'recepcion_id' and accion = 'crear';
  if v_n = 1 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la auditoría registra UNA creación (hay ' || v_n || ')'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  -- 4) otra recepción con la guía repetida es rechazada
  v_e := null;
  begin perform public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', v_u2)); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_DUPLICADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: guía repetida con otro identificador se rechaza ' || coalesce(v_e, '(no dio error)'); end if;

  -- 5) corregida (misma tarjeta, mismo identificador, otra guía) se acepta como nueva
  v_e := null; v_r2 := null;
  begin v_r2 := public.api_m01_guardar_recepcion((v_base || jsonb_build_object('client_uuid', v_u2)) || jsonb_build_object('guia_remision', 'ZZ-P10-B'));
  exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r2->>'duplicado')::boolean = false and v_r2->>'recepcion_id' <> v_r->>'recepcion_id' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la corrección con el mismo identificador crea la recepción ' || coalesce(v_e, v_r2::text); end if;

  -- 6) reenviar el primer envío después de que se editó NO deshace la edición
  v_r2 := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', v_u1, 'recepcion_id', v_r->>'recepcion_id', 'version', (v_r->>'version')::integer, 'observacion', 'ZZ editada'));
  v_r2 := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', v_u1));
  reset role;
  select count(*) into v_n from m01_recepcion.recepciones where recepcion_id = v_r->>'recepcion_id' and observacion = 'ZZ editada';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  if (v_r2->>'duplicado')::boolean = true and v_n = 1
  then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reenviar después de editar no pisa la edición ' || v_r2::text; end if;

  -- 7) sin identificador no se acepta
  v_e := null;
  begin perform public.api_m01_guardar_recepcion(v_base - 'client_uuid'); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sin client_uuid se rechaza ' || coalesce(v_e, '(no dio error)'); end if;

  raise exception 'PRUEBAS DE LA PARTE 10: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
