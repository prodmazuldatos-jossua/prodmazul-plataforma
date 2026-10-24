-- Prodmazul · Fase 4 · Parte 5 · Prueba de anular, eliminar y reactivar EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
--
-- Qué hace: actúa como tu usuario administrador general, crea recepciones de prueba, las anula, elimina y reactiva,
-- y comprueba que se rechace lo incorrecto. Al final se detiene a propósito con un mensaje de error que contiene
-- el resultado, y por eso NO queda ningún dato de prueba guardado.
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA PARTE 5: NN correctas, 0 con fallo.»
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
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '998-998-998',
    'proveedor', 'ZZ PRUEBA PROVEEDOR', 'especie', 'ZZ PRUEBA ESPECIE',
    'num_gavetas_bines', 1, 'libras_reportadas', 100, 'libras_planta', 99,
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',50)));

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  v_a := (public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P5-A')))->>'recepcion_id';
  v_b := (public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P5-B', 'estado', 'borrador', 'gavetas', '[]'::jsonb, 'libras_planta', null)))->>'recepcion_id';

  v_e := null;
  begin perform public.api_m01_anular(v_a, '', 1); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: anular sin motivo ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_anular(v_a, 'abc', 1); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: anular con motivo de menos de 5 caracteres ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_anular(v_a, 'motivo de prueba', 9); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VERSION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: anular con una versión vieja ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_anular('REC-20000101-9999', 'motivo de prueba', 1); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_NO_ENCONTRADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: anular una recepción inexistente ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_anular(v_a, '  Guía mal digitada  ', 1); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'estado' = 'anulado' and (v_r->>'version')::int = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: anular una cerrada ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_obtener_recepcion(v_a); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'motivo_anulacion' = 'Guía mal digitada' and v_r->>'estado_previo' = 'cerrado' and v_r->>'anulado_en' is not null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: quedan motivo, estado previo y fecha ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null;
  begin perform public.api_m01_anular(v_a, 'otra vez aquí', 2); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_ESTADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: anular dos veces ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_guardar_recepcion((public.api_m01_obtener_recepcion(v_a) - 'gavetas') || jsonb_build_object('estado','cerrado','gavetas', jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',50)), 'client_uuid', gen_random_uuid())); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_ESTADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una anulada no se edita ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_listar_recepciones(jsonb_build_object('busqueda','ZZ-P5')); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'total')::int = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el listado normal no muestra la anulada ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_listar_recepciones(jsonb_build_object('busqueda','ZZ-P5','estado','anulado')); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'total')::int = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el filtro «anulado» sí ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_anular(v_b, 'duplicado por error', 1); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'estado' = 'anulado') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: anular un borrador ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null;
  begin perform public.api_m01_eliminar(v_a, ' ', 2); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: eliminar sin motivo ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_eliminar(v_a, 'limpieza de prueba', 1); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VERSION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: eliminar con una versión vieja ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_eliminar(v_a, 'limpieza de prueba', 2); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'estado' = 'eliminado' and (v_r->>'version')::int = 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: eliminar una anulada ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_obtener_recepcion(v_a); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'motivo_anulacion' = 'Guía mal digitada' and v_r->>'eliminado_por' = v_admin::text) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se conservan el motivo de anulación y quién eliminó ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null;
  begin perform public.api_m01_eliminar(v_a, 'otra vez aquí', 3); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_ESTADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: eliminar dos veces ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_listar_recepciones(jsonb_build_object('busqueda','ZZ-P5','estado','eliminado')); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'total')::int = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el filtro «eliminado» la muestra al administrador ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_listar_recepciones(jsonb_build_object('busqueda','ZZ-P5','estado','todos')); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'total')::int = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: «todos» incluye anuladas y eliminadas para el administrador ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null;
  begin perform public.api_m01_reactivar(v_a, 1); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VERSION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reactivar con una versión vieja ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_reactivar(v_a, 3); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'estado' = 'anulado') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reactivar una eliminada que antes estaba anulada la devuelve a anulada ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_reactivar(v_a, 4); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'estado' = 'cerrado') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reactivar la anulada la devuelve a cerrada y limpia la anulación ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_obtener_recepcion(v_a); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'motivo_anulacion' is null and v_r->>'anulado_en' is null and v_r->>'eliminado_en' is null and v_r->>'estado_previo' is null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: quedó limpia ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null;
  begin perform public.api_m01_reactivar(v_a, 5); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_ESTADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reactivar una que no está anulada ni eliminada ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_reactivar(v_b, 2); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'estado' = 'borrador') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el borrador anulado vuelve a borrador ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_guardar_recepcion((public.api_m01_obtener_recepcion(v_b) - 'gavetas') || jsonb_build_object('observacion','ok','client_uuid', gen_random_uuid())); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'version')::int = 4) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: tras reactivar se puede editar de nuevo ' || coalesce(v_e, coalesce(v_r::text, '')); end if;

  -- Un usuario sin perfil no tiene permisos
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  v_e := null;
  begin perform public.api_m01_anular(v_a, 'motivo de prueba', 1); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_PERMISO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario sin permisos no puede anular ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_eliminar(v_a, 'motivo de prueba', 1); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_PERMISO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario sin permisos no puede eliminar ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_reactivar(v_a, 1); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_PERMISO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario sin permisos no puede reactivar ' || coalesce(v_e, '(no dio error)'); end if;

  reset role;
  -- La auditoría registró cada cambio (se lee ya como administrador de la base de datos)
  if (select count(*) from core.auditoria where entidad_id in (v_a, v_b) and accion in ('anular','eliminar','reactivar')) = 6 then
    v_ok := v_ok + 1;
  else
    v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la auditoría debía tener 6 cambios de estado';
  end if;
  -- Se detiene a propósito para deshacer todos los datos de prueba.
  raise exception 'PRUEBAS DE LA PARTE 5: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
