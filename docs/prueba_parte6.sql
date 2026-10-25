-- Prodmazul · Fase 4 · Parte 6 · Prueba del acumulado de un lote EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
--
-- Qué hace: actúa como tu usuario administrador general, crea recepciones de prueba en un lote de prueba y comprueba
-- que api_obtener_lote cuente camiones y libras, y que las anuladas y eliminadas no sumen. Al final se detiene a
-- propósito con un mensaje de error que contiene el resultado, y por eso NO queda ningún dato de prueba guardado.
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA PARTE 6: 11 correctas, 0 con fallo.»
-- Ese «error» es normal: es la forma de deshacer los datos de prueba.

do $prueba$
declare
  v_admin uuid;
  v_ok    integer := 0;
  v_mal   integer := 0;
  v_txt   text := '';
  v_e     text;
  v_r     jsonb;
  v_a     text;
  v_b     text;
  v_hoy   date := (now() at time zone 'America/Guayaquil')::date;
  v_base  jsonb;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;
  v_base := jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '996-996-996',
    'proveedor', 'ZZ PRUEBA PROVEEDOR', 'especie', 'ZZ PRUEBA ESPECIE', 'num_gavetas_bines', 1,
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',50)));

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  v_e := null; v_r := null;
  begin v_r := public.api_obtener_lote('996-996-996'); exception when others then v_e := sqlerrm; end;
  if v_e is null and (not (v_r->>'existe')::boolean and (v_r->>'camiones')::int = 0 and (v_r->>'libras_planta')::numeric = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un lote que no existe: existe=false y todo en 0 ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_a := (public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P6-A', 'libras_reportadas', 1000, 'libras_planta', 990)))->>'recepcion_id';
  v_e := null; v_r := null;
  begin v_r := public.api_obtener_lote('996-996-996'); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'existe')::boolean and (v_r->>'camiones')::int = 1 and (v_r->>'libras_reportadas')::numeric = 1000 and (v_r->>'libras_planta')::numeric = 990) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con una recepción: 1 camión, 1000 reportadas y 990 de planta ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_b := (public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P6-B', 'libras_reportadas', 500, 'libras_planta', 495)))->>'recepcion_id';
  v_e := null; v_r := null;
  begin v_r := public.api_obtener_lote('996-996-996'); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'camiones')::int = 2 and (v_r->>'libras_reportadas')::numeric = 1500 and (v_r->>'libras_planta')::numeric = 1485) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con dos recepciones suma 2 camiones, 1500 y 1485 ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_obtener_lote('996-996-996'); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'proveedor_nombre' = 'ZZ PRUEBA PROVEEDOR' and v_r->>'especie_nombre' = 'ZZ PRUEBA ESPECIE') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: conserva el proveedor y la especie del lote ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin perform public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P6-C', 'estado', 'borrador', 'gavetas', '[]'::jsonb, 'libras_reportadas', 100)); v_r := public.api_obtener_lote('996-996-996'); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'camiones')::int = 3 and (v_r->>'libras_planta')::numeric = 1485 and (v_r->>'libras_reportadas')::numeric = 1600) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un borrador cuenta como camión ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin perform public.api_m01_anular(v_a, 'prueba de anulación', 1); v_r := public.api_obtener_lote('996-996-996'); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'camiones')::int = 2 and (v_r->>'libras_planta')::numeric = 495) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: anular una recepción la resta ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin perform public.api_m01_eliminar(v_b, 'prueba de eliminación', 1); v_r := public.api_obtener_lote('996-996-996'); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'camiones')::int = 1 and (v_r->>'libras_planta')::numeric = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: eliminar otra la resta ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin perform public.api_m01_reactivar(v_a, 2); v_r := public.api_obtener_lote('996-996-996'); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'camiones')::int = 2 and (v_r->>'libras_planta')::numeric = 990) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reactivar la anulada la vuelve a sumar ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_obtener_lote('996-996-996'); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'lote_id' = '996-996-996') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el lote se acepta en minúsculas ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_e := null;
  begin perform public.api_obtener_lote('12-34'); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un lote con formato inválido da E_VALIDACION ' || coalesce(v_e, '(no dio error)'); end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  v_e := null;
  begin perform public.api_obtener_lote('996-996-996'); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_PERMISO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario sin permisos no puede consultar un lote ' || coalesce(v_e, '(no dio error)'); end if;

  reset role;
  raise exception 'PRUEBAS DE LA PARTE 6: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
