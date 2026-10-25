-- Prodmazul · Fase 4 · Parte 8 · Prueba de listado, edición y cambios de estado EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Actúa como tu usuario administrador general, crea datos de prueba (ZZ) y comprueba las reglas.
-- Al final se detiene a propósito con un mensaje de error que contiene el resultado, y por eso NO queda ningún dato guardado.
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA PARTE 8: 14 correctas, 0 con fallo.»
-- Ese «error» es normal: es la forma de deshacer los datos de prueba.

do $prueba$
declare
  v_admin uuid;
  v_ok    integer := 0;
  v_mal   integer := 0;
  v_txt   text := '';
  v_e     text;
  v_r     jsonb;
  v_id    text;
  v_ver   integer;
  v_n     integer;
  v_hoy   date := (now() at time zone 'America/Guayaquil')::date;
  v_base  jsonb;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;
  v_base := jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '994-994-994', 'llegada_en', 'gavetas',
    'proveedor', 'ZZ PRUEBA PROVEEDOR', 'especie', 'ZZ PRUEBA ESPECIE', 'num_gavetas_bines', 3,
    'libras_reportadas', 300, 'libras_planta', 295, 'guia_remision', 'ZZ-P8-A',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',50), jsonb_build_object('num_gaveta',2,'peso_lb',51)),
    'temperaturas', jsonb_build_array(jsonb_build_object('lectura_id',1,'num_gaveta',2,'temperatura_c',2.5)));

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  -- 1) crear y ver en el listado con los datos nuevos
  v_r := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid()));
  v_id := v_r->>'recepcion_id'; v_ver := (v_r->>'version')::integer;
  v_r := public.api_m01_listar_recepciones(jsonb_build_object('busqueda', 'ZZ-P8-A'));
  if (v_r->>'total')::integer = 1 and v_r->'items'->0->>'llegada_en' = 'gavetas'
     and (v_r->'items'->0->>'creado_por') = v_admin::text and (v_r->'items'->0->>'lote_cerrado')::boolean = false
     and v_r->'items'->0 ? 'motivo_anulacion'
  then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el listado trae llegada_en, creado_por, lote_cerrado y motivo_anulacion ' || v_r::text; end if;

  -- 2) editar sube la versión
  v_e := null; v_r := null;
  begin v_r := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'recepcion_id', v_id, 'version', v_ver, 'observacion', 'ZZ editada'));
  exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'version')::integer = v_ver + 1 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: editar sube la versión ' || coalesce(v_e, v_r::text); end if;

  v_r := public.api_m01_obtener_recepcion(v_id);
  if v_r->>'observacion' = 'ZZ editada' and jsonb_array_length(v_r->'gavetas') = 2 and (v_r->'temperaturas'->0->>'num_gaveta')::integer = 2
  then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el detalle trae lo editado ' || v_r::text; end if;

  -- 3) versión vieja
  v_e := null;
  begin perform public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'recepcion_id', v_id, 'version', v_ver));
  exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VERSION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: editar con versión vieja ' || coalesce(v_e, '(no dio error)'); end if;
  v_ver := v_ver + 1;

  -- 4) cerrar el lote al editar y seguir editando
  v_e := null; v_r := null;
  begin v_r := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'recepcion_id', v_id, 'version', v_ver, 'cerrar_lote', true));
  exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'lote_cerrado')::boolean = true then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cerrar el lote al editar ' || coalesce(v_e, v_r::text); end if;
  v_ver := v_ver + 1;

  v_e := null; v_r := null;
  begin v_r := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'recepcion_id', v_id, 'version', v_ver, 'observacion', 'ZZ con lote cerrado'));
  exception when others then v_e := sqlerrm; end;
  if v_e is null then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una recepción de un lote cerrado se puede seguir editando ' || v_e; end if;
  v_ver := v_ver + 1;

  v_e := null;
  begin perform public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P8-B'));
  exception when others then v_e := sqlerrm; end;
  if v_e like 'E_ESTADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una recepción nueva en lote cerrado se rechaza ' || coalesce(v_e, '(no dio error)'); end if;

  -- 5) anular
  v_e := null;
  begin perform public.api_m01_anular(v_id, 'abc', v_ver); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el motivo corto se rechaza ' || coalesce(v_e, '(no dio error)'); end if;

  v_e := null; v_r := null;
  begin v_r := public.api_m01_anular(v_id, 'ZZ prueba de anulación', v_ver); exception when others then v_e := sqlerrm; end;
  if v_e is null and v_r->>'estado' = 'anulado' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: anular ' || coalesce(v_e, v_r::text); end if;
  v_ver := (v_r->>'version')::integer;

  v_e := null;
  begin perform public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'recepcion_id', v_id, 'version', v_ver));
  exception when others then v_e := sqlerrm; end;
  if v_e like 'E_ESTADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una anulada no se edita ' || coalesce(v_e, '(no dio error)'); end if;

  -- 6) reactivar, eliminar, reactivar
  v_r := public.api_m01_reactivar(v_id, v_ver);
  v_ver := (v_r->>'version')::integer;
  if v_r->>'estado' = 'cerrado' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reactivar vuelve a cerrada ' || v_r::text; end if;

  v_r := public.api_m01_eliminar(v_id, 'ZZ prueba de eliminación', v_ver);
  v_ver := (v_r->>'version')::integer;
  v_r := public.api_m01_listar_recepciones(jsonb_build_object('estado', 'eliminado', 'busqueda', 'ZZ-P8-A'));
  if (v_r->>'total')::integer = 1 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la eliminada aparece en el filtro «eliminado» ' || v_r::text; end if;

  v_r := public.api_m01_reactivar(v_id, v_ver);
  if v_r->>'estado' = 'cerrado' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reactivar una eliminada ' || v_r::text; end if;

  reset role;
  select count(*) into v_n from core.auditoria where entidad_id = v_id and accion in ('anular', 'eliminar', 'reactivar');
  if v_n = 4 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: quedan 4 registros de auditoría (hay ' || v_n || ')'; end if;

  raise exception 'PRUEBAS DE LA PARTE 8: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
