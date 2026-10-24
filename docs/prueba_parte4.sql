-- Prodmazul · Fase 4 · Parte 4 · Prueba de guardar y consultar recepciones EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
--
-- Qué hace: actúa como tu usuario administrador general, guarda recepciones de prueba, las edita, las lista y
-- comprueba que se rechace lo incorrecto. Al final se detiene a propósito con un mensaje de error que contiene
-- el resultado, y por eso NO queda ningún dato de prueba guardado (ni recepciones, ni lotes, ni auditoría).
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA PARTE 4: NN correctas, 0 con fallo.»
-- Ese «error» es normal: es la forma de deshacer los datos de prueba.
-- REQUISITO: que exista al menos un usuario con es_admin_general = true en core.perfiles (el que creaste en la Fase 3).

do $prueba$
declare
  v_admin uuid;
  v_ok    integer := 0;
  v_mal   integer := 0;
  v_txt   text := '';
  v_e     text;
  v_r     jsonb;
  v_id    text;
  v_hoy   date := (now() at time zone 'America/Guayaquil')::date;
  v_base  jsonb;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;

  v_base := jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'placa_vehiculo', 'ZZP-0001',
    'lote_id', '998-998-998', 'proveedor', 'ZZ PRUEBA PROVEEDOR', 'especie', 'ZZ PRUEBA ESPECIE',
    'num_gavetas_bines', 3, 'libras_reportadas', 1000, 'libras_planta', 990,
    'hora_inicio_descarga', '08:00', 'hora_fin_descarga', '09:30',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',100), jsonb_build_object('num_gaveta',2,'peso_lb',110), jsonb_build_object('num_gaveta',3,'peso_lb',120)),
    'temperaturas', jsonb_build_array(jsonb_build_object('lectura_id',1,'bines','B1','temperatura_c',2.5)),
    'almacenamiento', jsonb_build_array(jsonb_build_object('num_bin','B1','sellos_recepcion','S1','sellos_almacenamiento','A1','temperatura_c',2.5,'libras_aprox',500)));

  -- Actuar como el administrador (igual que cuando la aplicación llama a la API con su sesión)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  v_e := null; v_r := null;
  begin v_r := public.api_m01_guardar_recepcion((v_base || '{}'::jsonb || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-' || gen_random_uuid()::text)) || jsonb_build_object('guia_remision','ZZ-G1','client_uuid','11111111-1111-1111-1111-111111111111')); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'recepcion_id') ~ '^REC-[0-9]{8}-[0-9]{4}$' and (v_r->>'version')::int = 1 and (v_r->>'duplicado')::boolean = false) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: crear una recepción cerrada ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_id := v_r->>'recepcion_id';
  v_e := null; v_r := null;
  begin v_r := public.api_m01_obtener_recepcion(v_id); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'estado' = 'cerrado' and (v_r->>'peso_promedio_lb')::numeric = 110 and (v_r->>'diferencia_lb')::numeric = -10 and (v_r->>'duracion_descarga_min')::int = 90 and jsonb_array_length(v_r->'gavetas') = 3 and jsonb_array_length(v_r->'almacenamiento') = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: obtener la recepción creada ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_guardar_recepcion((v_base || '{}'::jsonb || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-' || gen_random_uuid()::text)) || jsonb_build_object('guia_remision','ZZ-G1','client_uuid','11111111-1111-1111-1111-111111111111')); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'duplicado')::boolean and v_r->>'recepcion_id' = v_id) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reenviar el mismo envío no duplica ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_guardar_recepcion((v_base || '{"estado": "borrador", "libras_planta": null, "gavetas": []}'::jsonb || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-' || gen_random_uuid()::text))); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'estado' = 'borrador') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un borrador incompleto se guarda ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_guardar_recepcion((v_base || '{"proveedor": "OTRO NOMBRE"}'::jsonb || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-' || gen_random_uuid()::text))); exception when others then v_e := sqlerrm; end;
  if v_e is null and (true) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: otro envío del mismo lote hereda el proveedor ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_r := public.api_m01_obtener_recepcion(v_r->>'recepcion_id');
  if v_r->>'proveedor_nombre' = 'ZZ PRUEBA PROVEEDOR' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el proveedor se hereda del lote'; end if;
  v_e := null;
  begin perform public.api_m01_guardar_recepcion((v_base || '{}'::jsonb || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-' || gen_random_uuid()::text)) || jsonb_build_object('guia_remision','ZZ-G1')); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_DUPLICADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: guía repetida ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_guardar_recepcion((v_base || '{}'::jsonb || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-' || gen_random_uuid()::text)) || jsonb_build_object('fecha_llegada', v_hoy + 1)); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: fecha futura ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_guardar_recepcion((v_base || '{}'::jsonb || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-' || gen_random_uuid()::text)) || jsonb_build_object('guia_remision','')); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: guía vacía ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_guardar_recepcion((v_base || '{}'::jsonb || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-' || gen_random_uuid()::text)) || jsonb_build_object('lote_id','12-34')); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: formato de lote inválido ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_guardar_recepcion((v_base || '{}'::jsonb || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-' || gen_random_uuid()::text)) || jsonb_build_object('gavetas', jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',-5)))); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: peso de gaveta negativo ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_guardar_recepcion((v_base || '{}'::jsonb || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-' || gen_random_uuid()::text)) || jsonb_build_object('hora_inicio_descarga','10:00','hora_fin_descarga','09:00')); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: hora fin antes del inicio ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_guardar_recepcion((v_base || '{}'::jsonb || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-' || gen_random_uuid()::text)) || jsonb_build_object('temperaturas', jsonb_build_array(jsonb_build_object('lectura_id',1,'bines','B9','temperatura_c',2)))); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: temperatura de un bin inexistente ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_guardar_recepcion((v_base || '{}'::jsonb || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-' || gen_random_uuid()::text)) || jsonb_build_object('gavetas','[]'::jsonb)); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cerrar sin gavetas ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_guardar_recepcion(v_base - 'client_uuid' || jsonb_build_object('guia_remision','ZZ-X')); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: falta client_uuid ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_guardar_recepcion((public.api_m01_obtener_recepcion(v_id) - 'gavetas') || jsonb_build_object('gavetas', jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',50)), 'temperaturas','[]'::jsonb, 'almacenamiento','[]'::jsonb, 'libras_planta', 1010, 'client_uuid', gen_random_uuid())); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'version')::int = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: editar con la versión correcta sube la versión ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_obtener_recepcion(v_id); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'diferencia_lb')::numeric = 10 and (v_r->>'peso_promedio_lb')::numeric = 50 and jsonb_array_length(v_r->'gavetas') = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los cambios quedaron guardados ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null;
  begin perform public.api_m01_guardar_recepcion((public.api_m01_obtener_recepcion(v_id) - 'gavetas') || jsonb_build_object('version', 1, 'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',50)))); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VERSION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: editar con una versión vieja ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_listar_recepciones(jsonb_build_object('busqueda','ZZ PRUEBA')); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'total')::int = 3 and jsonb_array_length(v_r->'items') = 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: listado «activos» trae las 3 recepciones de prueba ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_listar_recepciones(jsonb_build_object('busqueda','zz-g1')); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'total')::int = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: búsqueda por guía ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_m01_listar_recepciones(jsonb_build_object('busqueda','ZZ PRUEBA','limite',2,'desplazamiento',2)); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'total')::int = 3 and jsonb_array_length(v_r->'items') = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: paginación ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null;
  begin perform public.api_m01_listar_recepciones(jsonb_build_object('desde','hola')); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: filtro de fecha inválido ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_listar_catalogo('lotes','998'); exception when others then v_e := sqlerrm; end;
  if v_e is null and (jsonb_array_length(v_r) = 1 and v_r->0->>'proveedor_nombre' = 'ZZ PRUEBA PROVEEDOR') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: catálogo de lotes ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_obtener_lote('998-998-998'); exception when others then v_e := sqlerrm; end;
  if v_e is null and ((v_r->>'existe')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: obtener lote existente ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null; v_r := null;
  begin v_r := public.api_obtener_lote('997-997-997'); exception when others then v_e := sqlerrm; end;
  if v_e is null and (not (v_r->>'existe')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: obtener lote nuevo ' || coalesce(v_e, coalesce(v_r::text, '')); end if;
  v_e := null;
  begin perform public.api_m01_obtener_recepcion('REC-20000101-9999'); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_NO_ENCONTRADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: recepción inexistente ' || coalesce(v_e, '(no dio error)'); end if;

  -- Un usuario sin perfil no tiene permisos
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  v_e := null;
  begin perform public.api_m01_guardar_recepcion((v_base || '{}'::jsonb || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-' || gen_random_uuid()::text))); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_PERMISO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario sin permisos no puede guardar ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_listar_recepciones('{}'::jsonb); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_PERMISO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario sin permisos no puede listar ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null;
  begin perform public.api_m01_obtener_recepcion(v_id); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_PERMISO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario sin permisos no puede obtener ' || coalesce(v_e, '(no dio error)'); end if;

  reset role;
  -- Se detiene a propósito para deshacer todos los datos de prueba.
  raise exception 'PRUEBAS DE LA PARTE 4: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
