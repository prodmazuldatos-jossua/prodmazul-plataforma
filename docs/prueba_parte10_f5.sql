-- Prodmazul · Fase 5 · Parte 10 · Prueba de la migración 20 (configuración, auditoría, reabrir lotes y catálogo) EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Crea usuarios, proveedores, especies, lotes y recepciones de prueba (ZZ P10), cambia parámetros, cierra y reabre lotes
-- y une nombres duplicados. NO deja nada guardado: al final se detiene a propósito con un mensaje de error que contiene
-- el resultado (eso deshace TODOS los datos de prueba, incluidos los cambios de configuración y los nombres unidos).
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA FASE 5 · PARTE 10: NN correctas, 0 con fallo.»
-- Ese «error» es normal: es la forma de deshacer los datos de prueba.

do $prueba$
declare
  v_admin uuid;
  v_am  uuid := gen_random_uuid();   -- administrador del módulo (rol admin_modulo)
  v_op  uuid := gen_random_uuid();   -- operativo
  v_co  uuid := gen_random_uuid();   -- consulta
  v_p1 uuid; v_p2 uuid; v_p3 uuid;   -- proveedores: Sol, Sol S.A., Otra
  v_e1 uuid; v_e2 uuid;              -- especies: Entero, Entero.
  v_ok  integer := 0;
  v_mal integer := 0;
  v_txt text := '';
  v_e   text;
  v_r   jsonb;
  v_r2  jsonb;
  v_n   bigint;
  v_n2  bigint;
  v_aud0 bigint;
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
  v_lbs numeric;
  v_rec text;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;

  -- 1) existen y están protegidas
  if (has_function_privilege('authenticated', 'public.api_admin_config_listar()', 'execute') and not has_function_privilege('anon', 'public.api_admin_config_listar()', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: api_admin_config_listar debe poder ejecutarla un usuario con sesión y no una persona anónima (¿falta la migración 20?)'; end if;
  if (has_function_privilege('authenticated', 'public.api_admin_config_cambiar(text,jsonb)', 'execute') and not has_function_privilege('anon', 'public.api_admin_config_cambiar(text,jsonb)', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: api_admin_config_cambiar debe poder ejecutarla un usuario con sesión y no una persona anónima (¿falta la migración 20?)'; end if;
  if (has_function_privilege('authenticated', 'public.api_admin_auditoria(jsonb)', 'execute') and not has_function_privilege('anon', 'public.api_admin_auditoria(jsonb)', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: api_admin_auditoria debe poder ejecutarla un usuario con sesión y no una persona anónima (¿falta la migración 20?)'; end if;
  if (has_function_privilege('authenticated', 'public.api_admin_lotes(jsonb)', 'execute') and not has_function_privilege('anon', 'public.api_admin_lotes(jsonb)', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: api_admin_lotes debe poder ejecutarla un usuario con sesión y no una persona anónima (¿falta la migración 20?)'; end if;
  if (has_function_privilege('authenticated', 'public.api_m01_reabrir_lote(text,text)', 'execute') and not has_function_privilege('anon', 'public.api_m01_reabrir_lote(text,text)', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: api_m01_reabrir_lote debe poder ejecutarla un usuario con sesión y no una persona anónima (¿falta la migración 20?)'; end if;
  if (has_function_privilege('authenticated', 'public.api_admin_catalogo(jsonb)', 'execute') and not has_function_privilege('anon', 'public.api_admin_catalogo(jsonb)', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: api_admin_catalogo debe poder ejecutarla un usuario con sesión y no una persona anónima (¿falta la migración 20?)'; end if;
  if (has_function_privilege('authenticated', 'public.api_admin_catalogo_unir(text,uuid,uuid,text)', 'execute') and not has_function_privilege('anon', 'public.api_admin_catalogo_unir(text,uuid,uuid,text)', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: api_admin_catalogo_unir debe poder ejecutarla un usuario con sesión y no una persona anónima (¿falta la migración 20?)'; end if;
  if (to_regprocedure('public.api_m01_reabrir_lote(text)') is null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la versión anterior de reabrir lote (sin motivo) debe haber desaparecido'; end if;
  if (not has_table_privilege('authenticated', 'core.catalogo_alias', 'select') and not has_table_privilege('anon', 'core.catalogo_alias', 'select')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la tabla de alias no debe ser accesible desde la aplicación'; end if;

  -- 2) usuarios y datos de prueba
  insert into auth.users (id, email) values (v_am, 'zz-p10-am@prueba.invalid'), (v_op, 'zz-p10-op@prueba.invalid'), (v_co, 'zz-p10-co@prueba.invalid');
  update core.perfiles set nombre = 'ZZ P10 Admin Modulo' where user_id = v_am; update core.perfiles set nombre = 'ZZ P10 Operativo' where user_id = v_op; update core.perfiles set nombre = 'ZZ P10 Consulta' where user_id = v_co;
  insert into core.usuario_modulo_rol (user_id, modulo_id, rol_id) values (v_am, 'M01', 'admin_modulo'), (v_op, 'M01', 'operativo'), (v_co, 'M01', 'consulta');
  if (core.clave_parecida('ZZ Camaronera Sol S.A.') = core.clave_parecida('zz  camaronera sol') and core.clave_parecida('Entero.') = core.clave_parecida('ENTERO') and core.clave_parecida('Sol') <> core.clave_parecida('Sol Norte')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la clave de nombres parecidos debe ignorar tildes, signos, mayúsculas y «S.A.», sin juntar nombres distintos'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_guardar_recepcion(jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '981-981-981', 'proveedor', 'ZZ P10 Camaronera Sol', 'especie', 'ZZ P10 Entero',
    'num_gavetas_bines', 1, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-F5P10-A',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 99)),
    'client_uuid', gen_random_uuid()));
  reset role;
  v_rec := v_r ->> 'recepcion_id';
  if (v_rec is not null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se guardó la recepción de prueba A'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_guardar_recepcion(jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '982-982-982', 'proveedor', 'ZZ P10 Camaronera Sol S.A.', 'especie', 'ZZ P10 Entero.',
    'num_gavetas_bines', 1, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-F5P10-B',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 99)), 'cerrar_lote', true,
    'client_uuid', gen_random_uuid()));
  reset role;
  if ((v_r ->> 'lote_cerrado')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la recepción B debe cerrar el lote 982-982-982'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_guardar_recepcion(jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '983-983-983', 'proveedor', 'ZZ P10 Otra', 'especie', 'ZZ P10 Entero',
    'num_gavetas_bines', 1, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-F5P10-O',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 99)),
    'client_uuid', gen_random_uuid()));
  reset role;
  select id into v_p1 from core.proveedores where nombre_normalizado = 'ZZ P10 CAMARONERA SOL'; select id into v_p2 from core.proveedores where nombre_normalizado = 'ZZ P10 CAMARONERA SOL S.A.'; select id into v_p3 from core.proveedores where nombre_normalizado = 'ZZ P10 OTRA';
  select id into v_e1 from core.especies where nombre_normalizado = 'ZZ P10 ENTERO'; select id into v_e2 from core.especies where nombre_normalizado = 'ZZ P10 ENTERO.';
  if (v_p1 is not null and v_p2 is not null and v_p3 is not null and v_e1 is not null and v_e2 is not null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se crearon los proveedores y especies de prueba'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_cerrar_lote('981-981-981');
  reset role;
  if ((select cerrado from core.lotes where lote_id = '981-981-981')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el lote 981-981-981 quedó cerrado'; end if;

  -- 3) quien no administra no puede entrar a nada
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_listar(); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo no debe poder ver la configuración'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('dias_retencion_fotos', '90'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo no debe poder cambiar la configuración'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_auditoria('{}'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo no debe poder consultar la auditoría'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_lotes('{}'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo no debe poder ver los lotes'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_reabrir_lote('981-981-981', 'intento sin permiso'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo no debe poder reabrir un lote'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_catalogo('{}'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo no debe poder ver el catálogo'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_catalogo_unir('proveedores', v_p2, v_p1, 'intento sin permiso'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo no debe poder unir nombres'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_co, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_co::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_listar(); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario de consulta no debe poder ver la configuración'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_co, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_co::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('dias_retencion_fotos', '90'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario de consulta no debe poder cambiar la configuración'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_co, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_co::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_auditoria('{}'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario de consulta no debe poder consultar la auditoría'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_co, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_co::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_lotes('{}'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario de consulta no debe poder ver los lotes'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_co, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_co::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_reabrir_lote('981-981-981', 'intento sin permiso'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario de consulta no debe poder reabrir un lote'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_co, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_co::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_catalogo('{}'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario de consulta no debe poder ver el catálogo'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_co, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_co::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_catalogo_unir('proveedores', v_p2, v_p1, 'intento sin permiso'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario de consulta no debe poder unir nombres'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_listar(); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una sesión sin perfil no debe poder ver la configuración'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('dias_retencion_fotos', '90'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una sesión sin perfil no debe poder cambiar la configuración'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_auditoria('{}'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una sesión sin perfil no debe poder consultar la auditoría'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_lotes('{}'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una sesión sin perfil no debe poder ver los lotes'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_reabrir_lote('981-981-981', 'intento sin permiso'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una sesión sin perfil no debe poder reabrir un lote'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_catalogo('{}'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una sesión sin perfil no debe poder ver el catálogo'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_catalogo_unir('proveedores', v_p2, v_p1, 'intento sin permiso'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una sesión sin perfil no debe poder unir nombres'; end if;
  if ((select cerrado from core.lotes where lote_id = '981-981-981') and exists (select 1 from core.proveedores where id = v_p2)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los intentos sin permiso no cambiaron nada'; end if;

  -- 4) configuración: ver
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_am, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_am::text, true); set local role authenticated;
  v_r := public.api_admin_config_listar();
  reset role;
  if (jsonb_array_length(v_r -> 'parametros') = 8) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la configuración debe listar 8 parámetros'; end if;
  if ((select (x -> 'valor')::numeric from jsonb_array_elements(v_r -> 'parametros') x where x ->> 'clave' = 'dias_retencion_fotos') = (select (valor #>> '{}')::numeric from core.config where clave = 'dias_retencion_fotos')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el valor mostrado debe ser el que está en core.config'; end if;
  if (not exists (select 1 from jsonb_array_elements(v_r -> 'parametros') x where x ->> 'clave' in ('sync_activa', 'purga_activa', 'formulario_m01'))) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la pantalla no debe ofrecer los interruptores de sincronización/purga ni el encabezado del formulario'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_config_listar();
  reset role;
  if (jsonb_array_length(v_r -> 'parametros') = 8) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador general también ve la configuración'; end if;

  -- 5) configuración: cambiar con validación
  select coalesce(max(evento_id), 0) into v_aud0 from core.auditoria;
  update core.config set valor = '60'::jsonb where clave = 'dias_retencion_fotos';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_config_cambiar('dias_retencion_fotos', '90'::jsonb);
  reset role;
  if ((v_r ->> 'cambio')::boolean and (select valor from core.config where clave = 'dias_retencion_fotos') = '90'::jsonb) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un valor válido se guarda'; end if;
  if (exists (select 1 from core.auditoria where evento_id > v_aud0 and accion = 'cambiar_config' and entidad = 'config' and entidad_id = 'dias_retencion_fotos' and user_id = v_admin and detalle -> 'antes' = '60'::jsonb and detalle -> 'despues' = '90'::jsonb)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el cambio queda en la auditoría con el valor anterior y el nuevo'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_config_listar();
  reset role;
  if ((select x ->> 'cambiado_por' from jsonb_array_elements(v_r -> 'parametros') x where x ->> 'clave' = 'dias_retencion_fotos') = 'Admin' or (select x ->> 'cambiado_por' from jsonb_array_elements(v_r -> 'parametros') x where x ->> 'clave' = 'dias_retencion_fotos') is not null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la lista muestra quién hizo el último cambio'; end if;
  select coalesce(max(evento_id), 0) into v_aud0 from core.auditoria;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_config_cambiar('dias_retencion_fotos', '90'::jsonb);
  reset role;
  if (not (v_r ->> 'cambio')::boolean and not exists (select 1 from core.auditoria where evento_id > v_aud0)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: guardar el mismo valor no inventa un cambio ni una línea de auditoría'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('dias_retencion_fotos', '6'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar menos del mínimo (7 días)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('dias_retencion_fotos', '5000'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar más del máximo (3650 días)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('dias_retencion_fotos', '30.5'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un número con decimales donde va un entero'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('dias_retencion_fotos', '"treinta"'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un texto donde va un número'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('dias_retencion_fotos', 'null'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un valor nulo'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('dias_retencion_fotos', 'true'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un sí/no donde va un número'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('factor_lb_kg', '3'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un factor fuera de 2.2 a 2.21'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('factor_lb_kg', '2.2046212'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un factor con más de 5 decimales'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('max_fotos_recepcion', '0'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar cero fotos por recepción'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('max_fotos_recepcion', '21'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar más de 20 fotos por recepción'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('formato_lote', '"abc"'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un formato sin ^ y $'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('formato_lote', '"^("'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar una expresión regular rota'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('formato_lote', '"^[0-9]*$"'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un formato que acepta lote vacío'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('formato_lote', '""'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un formato vacío'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('sync_activa', '5'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un parámetro que no se cambia desde aquí'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar('no_existe', '5'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un parámetro que no existe'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_config_cambiar(null, '5'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar una clave vacía'; end if;
  if ((select valor from core.config where clave = 'dias_retencion_fotos') = '90'::jsonb and (select valor from core.config where clave = 'sync_activa') is not distinct from (select valor from core.config where clave = 'sync_activa') and (select valor from core.config where clave = 'max_fotos_recepcion') = '5'::jsonb) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los valores rechazados no cambiaron nada'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_am, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_am::text, true); set local role authenticated;
  v_r := public.api_admin_config_cambiar('sync_alerta_horas', '8'::jsonb);
  reset role;
  if (exists (select 1 from core.auditoria where accion = 'cambiar_config' and entidad_id = 'sync_alerta_horas' and user_id = v_am and detalle -> 'despues' = '8'::jsonb)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador del módulo también puede cambiarla, y queda a su nombre'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_config_cambiar('factor_lb_kg', '2.2'::jsonb);
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_config_publica();
  reset role;
  if ((v_r ->> 'factor_lb_kg')::numeric = 2.2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la aplicación recibe el nuevo factor'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_config_cambiar('factor_lb_kg', '2.20462'::jsonb);
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_config_cambiar('formato_lote', '"^[0-9]{3}$"'::jsonb);
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_cerrar_lote('123-123-123'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con el formato nuevo, un lote como 123-123-123 deja de ser válido'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_config_cambiar('formato_lote', to_jsonb('^([A-Z]?[0-9]{3}|[0-9]{3}[A-Z]?)(-([A-Z]?[0-9]{3}|[0-9]{3}[A-Z]?)){2}$'::text));
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_cerrar_lote('123-123-123'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_NO_ENCONTRADO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: al volver al formato original, 123-123-123 es válido otra vez (solo que no existe)'; end if;

  -- 6) auditoría: consulta con filtros
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true);  perform core.auditar('CORE', 'zz_p10_prueba', 'prueba', 'zz-p10-x', jsonb_build_object('clave', 'secreto', 'password', 'p', 'contrasena', 'c', 'otro', 1));
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria('{}'::jsonb);
  reset role;
  if ((v_r ->> 'total')::bigint = (select count(*) from core.auditoria)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sin filtros, el total coincide con la tabla'; end if;
  if ((v_r -> 'filas' -> 0 ->> 'evento_id')::bigint = (select max(evento_id) from core.auditoria) and jsonb_array_length(v_r -> 'filas') = least(30, (v_r ->> 'total')::int)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: va del más nuevo al más antiguo y trae hasta 30 por página'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria(jsonb_build_object('accion', 'cambiar_config'));
  reset role;
  if ((v_r ->> 'total')::bigint = (select count(*) from core.auditoria where accion = 'cambiar_config') and (v_r ->> 'total')::bigint >= 4) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el filtro por acción coincide con la tabla'; end if;
  if ((select coalesce(sum((f ->> 'evento_id')::bigint), 0) from jsonb_array_elements(v_r -> 'filas') f) = (select coalesce(sum(evento_id), 0) from (select evento_id from core.auditoria where accion = 'cambiar_config' order by evento_id desc limit 30) q)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: las filas devueltas son las mismas de la tabla'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria(jsonb_build_object('usuario', v_am::text));
  reset role;
  if ((v_r ->> 'total')::bigint = (select count(*) from core.auditoria where user_id = v_am) and (v_r ->> 'total')::bigint >= 1 and (v_r -> 'filas' -> 0 ->> 'quien') = 'ZZ P10 Admin Modulo') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el filtro por usuario coincide con la tabla y muestra el nombre'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria(jsonb_build_object('modulo', 'M01'));
  reset role;
  if ((v_r ->> 'total')::bigint = (select count(*) from core.auditoria where modulo_id = 'M01') and not exists (select 1 from jsonb_array_elements(v_r -> 'filas') f where f ->> 'modulo' <> 'M01')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el filtro por módulo coincide con la tabla'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria(jsonb_build_object('desde', v_hoy::text, 'hasta', v_hoy::text));
  reset role;
  if ((v_r ->> 'total')::bigint = (select count(*) from core.auditoria where creado_en >= (v_hoy::timestamp at time zone 'America/Guayaquil') and creado_en < ((v_hoy + 1)::timestamp at time zone 'America/Guayaquil')) and (v_r ->> 'total')::bigint >= 10) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el filtro por fecha usa el día de Ecuador y coincide con la tabla'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria(jsonb_build_object('desde', (v_hoy + 1)::text));
  reset role;
  if ((v_r ->> 'total')::bigint = 0 and jsonb_array_length(v_r -> 'filas') = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una fecha futura no devuelve nada'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria(jsonb_build_object('hasta', (v_hoy - 3650)::text));
  reset role;
  if ((v_r ->> 'total')::bigint = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: «hasta» muy antiguo no devuelve nada'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria(jsonb_build_object('accion', 'cambiar_config', 'usuario', v_am::text, 'modulo', 'CORE', 'desde', v_hoy::text));
  reset role;
  if ((v_r ->> 'total')::bigint = (select count(*) from core.auditoria where accion = 'cambiar_config' and user_id = v_am and modulo_id = 'CORE' and creado_en >= (v_hoy::timestamp at time zone 'America/Guayaquil'))) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los filtros se pueden combinar'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria(jsonb_build_object('texto', 'dias_retencion'));
  reset role;
  if ((v_r ->> 'total')::bigint = (select count(*) from core.auditoria where entidad_id ilike '%dias_retencion%' or entidad ilike '%dias_retencion%') and (v_r ->> 'total')::bigint >= 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la búsqueda por texto coincide con la tabla'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria(jsonb_build_object('texto', 'zz-p10-x'));
  reset role;
  if ((v_r ->> 'total')::bigint = 1 and not (v_r::text ~* '("clave"|password|contrasena)') and (v_r -> 'filas' -> 0 -> 'detalle' ->> 'otro') = '1') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el detalle nunca muestra claves ni contraseñas, pero sí el resto'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria(jsonb_build_object('por_pagina', 2, 'pagina', 1));
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r2 := public.api_admin_auditoria(jsonb_build_object('por_pagina', 2, 'pagina', 2));
  reset role;
  if (jsonb_array_length(v_r -> 'filas') = 2 and jsonb_array_length(v_r2 -> 'filas') = 2 and (v_r2 -> 'filas' -> 0 ->> 'evento_id')::bigint < (v_r -> 'filas' -> 1 ->> 'evento_id')::bigint) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la paginación sigue en orden sin repetir filas'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria(jsonb_build_object('por_pagina', 5000));
  reset role;
  if ((v_r ->> 'por_pagina')::int = 100 and jsonb_array_length(v_r -> 'filas') <= 100) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: pedir demasiadas filas se limita a 100'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria(jsonb_build_object('pagina', 0, 'por_pagina', 0));
  reset role;
  if ((v_r ->> 'pagina')::int = 1 and (v_r ->> 'por_pagina')::int = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: página 0 y 0 por página se corrigen a 1'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria(null);
  reset role;
  if ((v_r ->> 'total')::bigint > 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sin parámetros también funciona'; end if;
  if (v_r -> 'opciones' -> 'acciones' ? 'cambiar_config' and v_r -> 'opciones' -> 'modulos' ? 'CORE' and v_r -> 'opciones' -> 'modulos' ? 'M01' and exists (select 1 from jsonb_array_elements(v_r -> 'opciones' -> 'usuarios') u where u ->> 'id' = v_am::text)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: las listas para filtrar traen acciones, módulos y usuarios reales'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_auditoria(jsonb_build_object('desde', '31/12/2026')); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar una fecha con otro formato'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_auditoria(jsonb_build_object('desde', '2026-12-31', 'hasta', '2026-01-01')); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar «desde» posterior a «hasta»'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_auditoria(jsonb_build_object('usuario', 'no-es-uuid')); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un usuario que no es un identificador'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_auditoria(jsonb_build_object('pagina', 'abc')); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar una página que no es número'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_am, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_am::text, true); set local role authenticated;
  v_r := public.api_admin_auditoria('{}'::jsonb);
  reset role;
  if ((v_r ->> 'total')::bigint > 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador del módulo también consulta la auditoría'; end if;
  select count(*) into v_n from core.auditoria; begin update core.auditoria set accion = 'x' where evento_id = (select max(evento_id) from core.auditoria); v_e := null; exception when others then v_e := sqlerrm; end;
  if (v_e like '%no se puede modificar%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la auditoría sigue siendo de solo inserción'; end if;

  -- 7) lotes: lista y reabrir con motivo
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_lotes(jsonb_build_object('busqueda', 'ZZ P10'));
  reset role;
  if ((v_r ->> 'total')::int = 2 and (select count(*) from jsonb_array_elements(v_r -> 'lotes') l where (l ->> 'cerrado')::boolean) = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la lista de cerrados trae los dos lotes de prueba cerrados (981 y 982)'; end if;
  if ((select (l ->> 'camiones')::int from jsonb_array_elements(v_r -> 'lotes') l where l ->> 'lote_id' = '981-981-981') = 1 and (select (l ->> 'libras_planta')::numeric from jsonb_array_elements(v_r -> 'lotes') l where l ->> 'lote_id' = '981-981-981') = 99) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cada lote muestra sus camiones y libras planta'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_lotes(jsonb_build_object('estado', 'abiertos', 'busqueda', 'ZZ P10'));
  reset role;
  if ((v_r ->> 'total')::int = 1 and v_r -> 'lotes' -> 0 ->> 'lote_id' = '983-983-983') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la lista de abiertos trae solo el 983'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_lotes(jsonb_build_object('estado', 'todos', 'busqueda', 'ZZ P10'));
  reset role;
  if ((v_r ->> 'total')::int = 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: «todos» trae los tres lotes de prueba'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_lotes(jsonb_build_object('estado', 'cerrados', 'busqueda', '982-982'));
  reset role;
  if ((v_r ->> 'total')::int = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se puede buscar por número de lote'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_lotes(jsonb_build_object('estado', 'todos'));
  reset role;
  if ((v_r ->> 'total')::bigint = (select count(*) from core.lotes)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: «todos» sin búsqueda coincide con la tabla de lotes'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_lotes(jsonb_build_object('estado', 'raros')); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un estado de lista inválido se rechaza'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_e := null; begin v_r := public.api_m01_guardar_recepcion(jsonb_build_object('estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '981-981-981', 'proveedor', 'ZZ P10 Camaronera Sol', 'especie', 'ZZ P10 Entero', 'num_gavetas_bines', 1, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-F5P10-C', 'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 99)), 'client_uuid', gen_random_uuid())); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_ESTADO%cerrado%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un lote cerrado NO admite otro camión'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_reabrir_lote('981-981-981', ''); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reabrir sin motivo se rechaza'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_reabrir_lote('981-981-981', 'abc'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un motivo de menos de 5 caracteres se rechaza'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_reabrir_lote('981-981-981', repeat('x', 501)); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un motivo de más de 500 caracteres se rechaza'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_reabrir_lote('999-999-999', 'lote que no existe'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_NO_ENCONTRADO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reabrir un lote que no existe da «no encontrado»'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_reabrir_lote('xx', 'formato inválido'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reabrir con un número de lote mal escrito se rechaza'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_reabrir_lote('983-983-983', 'ya estaba abierto'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_ESTADO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reabrir un lote que ya está abierto se rechaza'; end if;
  if ((select cerrado from core.lotes where lote_id = '981-981-981')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los intentos fallidos no reabrieron el lote'; end if;
  select coalesce(max(evento_id), 0) into v_aud0 from core.auditoria;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_am, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_am::text, true); set local role authenticated;
  v_r := public.api_m01_reabrir_lote(' 981-981-981 ', '  Llegó otro camión del mismo lote  ');
  reset role;
  if (not (v_r ->> 'cerrado')::boolean and not (select cerrado from core.lotes where lote_id = '981-981-981') and (select cerrado_en from core.lotes where lote_id = '981-981-981') is null and (select cerrado_por from core.lotes where lote_id = '981-981-981') is null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el lote queda abierto y sin datos de cierre'; end if;
  if (exists (select 1 from core.auditoria where evento_id > v_aud0 and accion = 'reabrir_lote' and entidad = 'lote' and entidad_id = '981-981-981' and user_id = v_am and detalle ->> 'motivo' = 'Llegó otro camión del mismo lote' and (detalle ->> 'camiones')::int = 1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la reapertura queda en la auditoría con quién, el motivo y los camiones'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_r := public.api_m01_guardar_recepcion(jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '981-981-981', 'proveedor', 'ZZ P10 Camaronera Sol', 'especie', 'ZZ P10 Entero',
    'num_gavetas_bines', 1, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-F5P10-C',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 99)),
    'client_uuid', gen_random_uuid()));
  reset role;
  if (v_r ->> 'recepcion_id' is not null and not (v_r ->> 'lote_cerrado')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un lote reabierto admite camiones otra vez'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_lotes(jsonb_build_object('estado', 'abiertos', 'busqueda', '981-981'));
  reset role;
  if ((v_r -> 'lotes' -> 0 ->> 'camiones')::int = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la lista muestra ahora 2 camiones en el lote reabierto'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_reabrir_lote('981-981-981', 'segunda vez seguida'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_ESTADO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: no se puede reabrir dos veces seguidas'; end if;
  v_n := (select count(*) from core.auditoria where accion = 'reabrir_lote' and entidad_id = '981-981-981');
  if (v_n = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: queda exactamente una línea de auditoría de reapertura'; end if;

  -- 8) catálogo: ver y detectar parecidos
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_catalogo(jsonb_build_object('tipo', 'proveedores', 'busqueda', 'ZZ P10'));
  reset role;
  if (jsonb_array_length(v_r -> 'items') = 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el catálogo de proveedores trae los 3 de prueba'; end if;
  if ((select (i ->> 'recepciones')::int from jsonb_array_elements(v_r -> 'items') i where i ->> 'id' = v_p1::text) = 2 and (select (i ->> 'recepciones')::int from jsonb_array_elements(v_r -> 'items') i where i ->> 'id' = v_p2::text) = 1 and (select (i ->> 'lotes')::int from jsonb_array_elements(v_r -> 'items') i where i ->> 'id' = v_p2::text) = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cada proveedor muestra cuántas recepciones y lotes tiene'; end if;
  if ((select i ->> 'grupo' from jsonb_array_elements(v_r -> 'items') i where i ->> 'id' = v_p1::text) = (select i ->> 'grupo' from jsonb_array_elements(v_r -> 'items') i where i ->> 'id' = v_p2::text) and (select i ->> 'grupo' from jsonb_array_elements(v_r -> 'items') i where i ->> 'id' = v_p3::text) is null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: «Sol» y «Sol S.A.» salen como parecidos y «Otra» no'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_catalogo(jsonb_build_object('tipo', 'proveedores', 'busqueda', 'ZZ P10', 'solo_parecidos', true));
  reset role;
  if (jsonb_array_length(v_r -> 'items') = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: «solo parecidos» deja los 2 nombres repetidos'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_catalogo(jsonb_build_object('tipo', 'especies', 'busqueda', 'ZZ P10', 'solo_parecidos', true));
  reset role;
  if (jsonb_array_length(v_r -> 'items') = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: también detecta las especies parecidas («Entero» y «Entero.»)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_catalogo('{}'::jsonb);
  reset role;
  if (v_r ->> 'tipo' = 'proveedores' and (v_r ->> 'total')::bigint = (select count(*) from core.proveedores)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sin tipo, muestra proveedores y el total coincide con la tabla'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_catalogo(jsonb_build_object('tipo', 'camiones')); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un catálogo que no existe se rechaza'; end if;

  -- 9) catálogo: unir duplicados
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_catalogo_unir('proveedores', v_p2, v_p2, 'mismo nombre'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar unir un nombre consigo mismo'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_catalogo_unir('proveedores', null, v_p1, 'sin origen'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar unir sin origen'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_catalogo_unir('proveedores', v_p2, v_p1, 'abc'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un motivo corto'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_catalogo_unir('camiones', v_p2, v_p1, 'tipo incorrecto'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se debe rechazar un catálogo inválido'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_catalogo_unir('proveedores', v_p2, gen_random_uuid(), 'destino inexistente'); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_NO_ENCONTRADO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un destino que no existe da «no encontrado»'; end if;
  if (exists (select 1 from core.proveedores where id = v_p2)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los rechazos no borraron nada'; end if;
  select coalesce(sum(libras_planta), 0) into v_lbs from m01_recepcion.recepciones where proveedor_id in (v_p1, v_p2) and estado in ('borrador', 'cerrado');
  select coalesce(max(evento_id), 0) into v_aud0 from core.auditoria;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_am, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_am::text, true); set local role authenticated;
  v_r := public.api_admin_catalogo_unir('proveedores', v_p2, v_p1, 'Es el mismo proveedor con S.A.');
  reset role;
  if ((v_r ->> 'recepciones')::int = 1 and (v_r ->> 'lotes')::int = 1 and v_r ->> 'destino_nombre' = 'ZZ P10 Camaronera Sol' and v_r ->> 'origen_nombre' = 'ZZ P10 Camaronera Sol S.A.') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: unir devuelve cuántas recepciones y lotes pasaron al nombre que se conserva'; end if;
  if (not exists (select 1 from core.proveedores where id = v_p2) and not exists (select 1 from m01_recepcion.recepciones where proveedor_id = v_p2) and not exists (select 1 from core.lotes where proveedor_id = v_p2)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el nombre duplicado desaparece y nada queda apuntando a él'; end if;
  if ((select proveedor_id from core.lotes where lote_id = '982-982-982') = v_p1 and (select count(*) from m01_recepcion.recepciones where proveedor_id = v_p1) = 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el lote 982 y sus recepciones pasaron al nombre conservado'; end if;
  if ((select coalesce(sum(libras_planta), 0) from m01_recepcion.recepciones where proveedor_id = v_p1 and estado in ('borrador', 'cerrado')) = v_lbs) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: las libras planta no cambian al unir (sumadas dan lo mismo)'; end if;
  if ((select cerrado from core.lotes where lote_id = '982-982-982')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el lote 982 sigue cerrado: unir no cambia el estado de los lotes'; end if;
  if (exists (select 1 from core.catalogo_alias where tipo = 'proveedor' and nombre_normalizado = 'ZZ P10 CAMARONERA SOL S.A.' and destino_id = v_p1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el nombre viejo queda como alias del conservado'; end if;
  if (exists (select 1 from core.auditoria where evento_id > v_aud0 and accion = 'unir_proveedor' and entidad_id = v_p1::text and user_id = v_am and detalle ->> 'motivo' = 'Es el mismo proveedor con S.A.' and detalle ->> 'origen_nombre' = 'ZZ P10 Camaronera Sol S.A.' and (detalle ->> 'recepciones')::int = 1 and (detalle ->> 'lotes')::int = 1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: unir queda en la auditoría con quién, el motivo y los números'; end if;
  if (exists (select 1 from core.sync_cola where tabla = 'core.proveedores' and operacion = 'borrar' and clave_json ->> 'id' = v_p2::text)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la copia en Sheets recibe la orden de quitar el nombre duplicado'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_r := public.api_m01_guardar_recepcion(jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '984-984-984', 'proveedor', 'zz p10 camaronera sol s.a.', 'especie', 'ZZ P10 Entero',
    'num_gavetas_bines', 1, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-F5P10-D',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 99)),
    'client_uuid', gen_random_uuid()));
  reset role;
  v_rec := v_r ->> 'recepcion_id';
  if ((select proveedor_id from m01_recepcion.recepciones where recepcion_id = v_rec) = v_p1 and not exists (select 1 from core.proveedores where nombre_normalizado = 'ZZ P10 CAMARONERA SOL S.A.')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: si alguien escribe el nombre viejo, la recepción va al nombre conservado y no se vuelve a crear el duplicado'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_catalogo_unir('proveedores', v_p1, v_p3, 'Se unen todos en el nombre Otra');
  reset role;
  if ((v_r ->> 'recepciones')::int = 4 and (v_r ->> 'lotes')::int = 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: unir en cadena pasa las recepciones y lotes al último nombre'; end if;
  if ((select count(*) from core.catalogo_alias where tipo = 'proveedor' and destino_id = v_p3) = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los alias anteriores ahora apuntan al último nombre'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_r := public.api_m01_guardar_recepcion(jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '985-985-985', 'proveedor', 'ZZ P10 Camaronera Sol S.A.', 'especie', 'ZZ P10 Entero',
    'num_gavetas_bines', 1, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-F5P10-E',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 99)),
    'client_uuid', gen_random_uuid()));
  reset role;
  v_rec := v_r ->> 'recepcion_id';
  if ((select proveedor_id from m01_recepcion.recepciones where recepcion_id = v_rec) = v_p3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el nombre más viejo también se redirige al último'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_catalogo(jsonb_build_object('tipo', 'proveedores', 'busqueda', 'ZZ P10'));
  reset role;
  if (jsonb_array_length(v_r -> 'items') = 1 and (v_r -> 'items' -> 0 ->> 'recepciones')::int = 6) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el catálogo muestra ahora un solo proveedor con las 6 recepciones'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_catalogo_unir('especies', v_e2, v_e1, 'Entero. es el mismo nombre con punto');
  reset role;
  if ((v_r ->> 'recepciones')::int = 1 and (v_r ->> 'lotes')::int = 1 and not exists (select 1 from core.especies where id = v_e2) and (select especie_id from core.lotes where lote_id = '982-982-982') = v_e1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: las especies también se unen, con sus recepciones y lotes'; end if;
  if (exists (select 1 from core.auditoria where accion = 'unir_especie' and entidad_id = v_e1::text)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: unir especies queda en la auditoría'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_r := public.api_m01_guardar_recepcion(jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '986-986-986', 'proveedor', 'ZZ P10 Otra', 'especie', 'zz p10 entero.',
    'num_gavetas_bines', 1, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-F5P10-F',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 99)),
    'client_uuid', gen_random_uuid()));
  reset role;
  v_rec := v_r ->> 'recepcion_id';
  if ((select especie_id from m01_recepcion.recepciones where recepcion_id = v_rec) = v_e1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el nombre viejo de la especie también se redirige'; end if;

  -- 10) lo que NO cambió
  if ((select count(*) from m01_recepcion.recepciones where guia_remision like 'G-F5P10-%') = 7 and (select count(*) from m01_recepcion.recepciones where guia_remision like 'G-F5P10-%' and estado <> 'cerrado') = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: ninguna recepción de prueba se perdió ni cambió de estado'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_mi_perfil();
  reset role;
  if ((v_r ->> 'es_admin_general')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador general sigue igual'; end if;
  raise exception E'PRUEBAS DE LA FASE 5 · PARTE 10: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
