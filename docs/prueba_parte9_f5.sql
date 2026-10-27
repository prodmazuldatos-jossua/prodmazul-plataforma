-- Prodmazul · Fase 5 · Parte 9 · Prueba de la migración 19 (administración de usuarios, auditoría e historial) EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Crea usuarios de prueba (ZZ P9), los modifica, los desactiva y reactiva, y comprueba permisos y auditoría.
-- NO deja nada guardado: al final se detiene a propósito con un mensaje de error que contiene el resultado
-- (eso deshace TODOS los datos de prueba). No toca tus usuarios reales ni cambia ninguna contraseña.
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA FASE 5 · PARTE 9: NN correctas, 0 con fallo.»
-- Ese «error» es normal: es la forma de deshacer los datos de prueba.

do $prueba$
declare
  v_admin uuid;
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_c1 text := 'zz-p9-uno@prueba.invalid';
  v_c2 text := 'zz-p9-dos@prueba.invalid';
  v_ok  integer := 0;
  v_mal integer := 0;
  v_txt text := '';
  v_e   text;
  v_r   jsonb;
  v_n   bigint;
  v_aud0 bigint;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;

  -- 1) existen y están protegidas
  if (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'api_admin_historial_usuarios')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: no existe api_admin_historial_usuarios (¿falta la migración 19?)'; end if;
  if (has_function_privilege('authenticated', 'public.api_admin_historial_usuarios(integer)', 'execute') and not has_function_privilege('anon', 'public.api_admin_historial_usuarios(integer)', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el historial debe poder ejecutarlo un usuario con sesión y no una persona anónima'; end if;
  if (not has_function_privilege('authenticated', 'public.adm_registrar_usuario(uuid,text,jsonb,uuid)', 'execute') and not has_function_privilege('anon', 'public.adm_registrar_usuario(uuid,text,jsonb,uuid)', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: adm_registrar_usuario no debe ser ejecutable desde la aplicación (solo la función de servidor)'; end if;
  if (not has_function_privilege('authenticated', 'public.adm_auditar_clave(uuid,uuid)', 'execute') and not has_function_privilege('anon', 'public.adm_auditar_clave(uuid,uuid)', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: adm_auditar_clave no debe ser ejecutable desde la aplicación'; end if;
  if (has_function_privilege('authenticated', 'public.api_admin_listar_usuarios()', 'execute') and not has_function_privilege('anon', 'public.api_admin_listar_usuarios()', 'execute') and not has_function_privilege('anon', 'public.api_admin_actualizar_usuario(uuid,text,boolean,jsonb)', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la lista y la edición de usuarios no deben ser accesibles de forma anónima'; end if;

  -- 2) usuarios de prueba (como lo hace la función de servidor: la cuenta de Auth y luego el registro)
  insert into auth.users (id, email) values (v_u1, v_c1), (v_u2, v_c2);
  if ((select count(*) from core.perfiles where user_id in (v_u1, v_u2)) = 2 and not exists (select 1 from core.usuario_modulo_rol where user_id in (v_u1, v_u2))) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario nuevo de Auth debe recibir un perfil SIN permisos'; end if;
  select coalesce(max(evento_id), 0) into v_aud0 from core.auditoria;
  v_r := public.adm_registrar_usuario(v_u1, '  ZZ P9   Uno ', '[{"modulo_id":"M01","rol_id":"operativo"}]'::jsonb, v_admin);
  if ((select nombre from core.perfiles where user_id = v_u1) = 'ZZ P9 Uno' and (select activo from core.perfiles where user_id = v_u1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el alta debe limpiar los espacios del nombre y dejar al usuario activo'; end if;
  if ((select rol_id from core.usuario_modulo_rol where user_id = v_u1 and modulo_id = 'M01') = 'operativo') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el alta debe asignar el rol pedido'; end if;
  if (exists (select 1 from core.auditoria where evento_id > v_aud0 and accion = 'crear_usuario' and entidad_id = v_u1::text and user_id = v_admin and detalle ->> 'correo' = v_c1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el alta debe quedar en la auditoría, con quién la hizo y el correo'; end if;
  v_e := null; begin perform public.adm_registrar_usuario(v_u2, '', '[]'::jsonb, v_admin); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un alta sin nombre debe rechazarse'; end if;
  v_e := null; begin perform public.adm_registrar_usuario(v_u2, 'ZZ P9 Dos', '[{"modulo_id":"M01","rol_id":"no_existe"}]'::jsonb, v_admin); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un alta con un rol que no existe debe rechazarse'; end if;
  v_r := public.adm_registrar_usuario(v_u2, 'ZZ P9 Dos', '[]'::jsonb, v_admin);

  -- 3) quien no es administrador general no puede ver ni cambiar usuarios
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_u1, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_u1::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_listar_usuarios(); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario de módulo no debe poder listar usuarios'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_u1, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_u1::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_actualizar_usuario(v_u2, 'Hackeado', true, '[]'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%' and (select nombre from core.perfiles where user_id = v_u2) = 'ZZ P9 Dos') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario de módulo no debe poder cambiar a otro (ni a sí mismo con más permisos)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_u1, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_u1::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_actualizar_usuario(v_u1, 'ZZ P9 Uno', true, '[{"modulo_id":"M01","rol_id":"admin_modulo"}]'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%' and (select rol_id from core.usuario_modulo_rol where user_id = v_u1 and modulo_id = 'M01') = 'operativo') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: nadie puede subirse a sí mismo de rol'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_u1, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_u1::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_historial_usuarios(10); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario de módulo no debe poder ver el historial de usuarios'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_listar_usuarios(); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una sesión sin perfil tampoco puede listar usuarios'; end if;

  -- 4) la lista del administrador coincide con la base
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_listar_usuarios();
  reset role;
  if (jsonb_array_length(v_r -> 'usuarios') = (select count(*) from core.perfiles)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la lista debe traer a todos los usuarios (el mismo número que core.perfiles)'; end if;
  if ((select u ->> 'correo' from jsonb_array_elements(v_r -> 'usuarios') u where u ->> 'user_id' = v_u1::text) = v_c1 and (select u -> 'roles' -> 0 from jsonb_array_elements(v_r -> 'usuarios') u where u ->> 'user_id' = v_u1::text) = '{"modulo_id": "M01", "rol_id": "operativo"}'::jsonb) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el usuario de prueba debe verse con su correo y su rol'; end if;
  if ((select count(*) from jsonb_array_elements(v_r -> 'usuarios') u where (u ->> 'es_admin_general')::boolean) = (select count(*) from core.perfiles where es_admin_general)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la lista debe marcar bien a los administradores generales'; end if;
  if (not (v_r::text ~* '(password|clave"|encrypted|hash)')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la lista nunca debe contener contraseñas ni claves'; end if;

  -- 5) cambiar nombre, rol y estado: cada cambio queda con su «antes» y «después»
  select coalesce(max(evento_id), 0) into v_aud0 from core.auditoria;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_actualizar_usuario(v_u1, 'ZZ P9 Uno Nuevo', true, '[{"modulo_id":"M01","rol_id":"consulta"}]'::jsonb);
  reset role;
  if ((v_r ->> 'cambios')::int = 2 and (select nombre from core.perfiles where user_id = v_u1) = 'ZZ P9 Uno Nuevo' and (select rol_id from core.usuario_modulo_rol where user_id = v_u1 and modulo_id = 'M01') = 'consulta') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cambiar nombre y rol debe aplicarse y contar 2 cambios'; end if;
  if (exists (select 1 from core.auditoria where evento_id > v_aud0 and accion = 'cambiar_nombre_usuario' and entidad_id = v_u1::text and detalle ->> 'antes' = 'ZZ P9 Uno' and detalle ->> 'despues' = 'ZZ P9 Uno Nuevo')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el cambio de nombre debe quedar con el nombre anterior y el nuevo'; end if;
  if (exists (select 1 from core.auditoria where evento_id > v_aud0 and accion = 'cambiar_roles_usuario' and entidad_id = v_u1::text and detalle -> 'antes' ->> 'M01' = 'operativo' and detalle -> 'despues' ->> 'M01' = 'consulta')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el cambio de rol debe quedar con el rol anterior y el nuevo'; end if;
  select coalesce(max(evento_id), 0) into v_aud0 from core.auditoria;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_actualizar_usuario(v_u1, 'ZZ P9 Uno Nuevo', true, '[]'::jsonb);
  reset role;
  if ((v_r ->> 'cambios')::int = 0 and exists (select 1 from core.auditoria where evento_id > v_aud0 and accion = 'actualizar_usuario' and entidad_id = v_u1::text and (detalle ->> 'sin_cambios')::boolean)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: guardar sin cambios no debe inventar cambios (queda un evento «sin cambios»)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_actualizar_usuario(v_u1, 'ZZ P9 Uno Nuevo', true, '[{"modulo_id":"M01","rol_id":null}]'::jsonb);
  reset role;
  if (not exists (select 1 from core.usuario_modulo_rol where user_id = v_u1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: poner «Sin acceso» debe quitar el rol de ese módulo'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_actualizar_usuario(v_u1, 'ZZ P9 Uno Nuevo', true, '[{"modulo_id":"M01","rol_id":"consulta"}]'::jsonb);
  reset role;

  -- 6) desactivar corta el acceso al instante; reactivar lo devuelve
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_u1, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_u1::text, true); set local role authenticated;
  v_r := public.api_m01_rep_proveedores('2001-01-01', '2001-01-31');
  reset role;
  if (jsonb_typeof(v_r -> 'filas') = 'array') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: antes de desactivar, el usuario con rol de consulta sí puede pedir un reporte'; end if;
  select coalesce(max(evento_id), 0) into v_aud0 from core.auditoria;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_actualizar_usuario(v_u1, 'ZZ P9 Uno Nuevo', false, '[]'::jsonb);
  reset role;
  if (not (select activo from core.perfiles where user_id = v_u1) and exists (select 1 from core.auditoria where evento_id > v_aud0 and accion = 'desactivar_usuario' and entidad_id = v_u1::text and (detalle ->> 'antes')::boolean and not (detalle ->> 'despues')::boolean)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: desactivar debe quedar con su propio evento (antes: activo, después: desactivado)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_u1, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_u1::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_rep_proveedores('2001-01-01', '2001-01-31'); exception when others then v_e := sqlerrm; end;
  v_r := public.api_mi_perfil();
  reset role;
  if (v_e like 'E_PERMISO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario desactivado debe ser rechazado en las funciones de la aplicación, aunque tenga la sesión abierta'; end if;
  if (not (v_r ->> 'activo')::boolean and jsonb_array_length(coalesce(v_r -> 'modulos', '[]'::jsonb)) = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario desactivado no debe ver ningún módulo en su perfil'; end if;
  if ((select rol_id from core.usuario_modulo_rol where user_id = v_u1 and modulo_id = 'M01') = 'consulta') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: desactivar no borra su rol: al reactivarlo, todo sigue como estaba'; end if;
  select coalesce(max(evento_id), 0) into v_aud0 from core.auditoria;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_actualizar_usuario(v_u1, 'ZZ P9 Uno Nuevo', true, '[]'::jsonb);
  reset role;
  if (exists (select 1 from core.auditoria where evento_id > v_aud0 and accion = 'reactivar_usuario' and entidad_id = v_u1::text)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: reactivar debe quedar con su propio evento'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_u1, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_u1::text, true); set local role authenticated;
  v_r := public.api_m01_rep_proveedores('2001-01-01', '2001-01-31');
  reset role;
  if (jsonb_typeof(v_r -> 'filas') = 'array') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: al reactivar, el usuario vuelve a poder trabajar al instante'; end if;

  -- 7) protecciones
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_actualizar_usuario(v_admin, 'Admin', false, '[]'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_ESTADO%' and (select activo from core.perfiles where user_id = v_admin)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: no se puede desactivar a un administrador general'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_actualizar_usuario(v_admin, 'Admin', true, '[{"modulo_id":"M01","rol_id":"operativo"}]'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_ESTADO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: no se le asignan roles a un administrador general'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_actualizar_usuario(v_u1, '   ', true, '[]'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el nombre vacío debe rechazarse'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_actualizar_usuario(v_u1, repeat('x', 61), true, '[]'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un nombre de más de 60 caracteres debe rechazarse'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_actualizar_usuario(v_u1, 'ZZ P9 Uno Nuevo', true, '[{"modulo_id":"M01","rol_id":"inventado"}]'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%' and (select rol_id from core.usuario_modulo_rol where user_id = v_u1 and modulo_id = 'M01') = 'consulta') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un rol inexistente debe rechazarse sin cambiar nada'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_actualizar_usuario(v_u1, 'ZZ P9 Uno Nuevo', true, '{}'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: unos roles con formato incorrecto deben rechazarse'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_admin_actualizar_usuario(gen_random_uuid(), 'Nadie', true, '[]'::jsonb); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_NO_ENCONTRADO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario que no existe debe dar «no encontrado»'; end if;

  -- 8) cambio de contraseña: solo queda constancia, nunca la contraseña
  select coalesce(max(evento_id), 0) into v_aud0 from core.auditoria;
  perform public.adm_auditar_clave(v_u1, v_admin);
  if (exists (select 1 from core.auditoria where evento_id > v_aud0 and accion = 'cambiar_clave_usuario' and entidad_id = v_u1::text and user_id = v_admin and detalle ->> 'correo' = v_c1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el cambio de contraseña debe quedar en la auditoría (quién y a quién)'; end if;
  if (not exists (select 1 from core.auditoria where entidad = 'usuario' and detalle::text ~* '("clave"|password|contrase)')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: ningún evento de auditoría de usuarios debe guardar una contraseña'; end if;

  -- 9) historial para el administrador
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_historial_usuarios(100);
  reset role;
  if (jsonb_typeof(v_r -> 'eventos') = 'array' and jsonb_array_length(v_r -> 'eventos') >= 8) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el historial debe traer los eventos de esta prueba'; end if;
  if ((v_r -> 'eventos' -> 0 ->> 'accion') = 'cambiar_clave_usuario' and (v_r -> 'eventos' -> 0 ->> 'usuario_correo') = v_c1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el historial va del más nuevo al más antiguo y muestra el correo del usuario'; end if;
  if (exists (select 1 from jsonb_array_elements(v_r -> 'eventos') e where e ->> 'accion' = 'crear_usuario' and e ->> 'usuario_correo' = v_c1 and (e ->> 'quien') is not null)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el historial debe mostrar quién hizo cada cambio'; end if;
  if (not exists (select 1 from jsonb_array_elements(v_r -> 'eventos') e where e ->> 'accion' not in ('crear_usuario', 'actualizar_usuario', 'cambiar_nombre_usuario', 'cambiar_roles_usuario', 'desactivar_usuario', 'reactivar_usuario', 'cambiar_clave_usuario'))) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el historial solo trae eventos de usuarios'; end if;
  if (not (v_r::text ~* '("clave"|password|contrase)')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el historial nunca debe contener contraseñas'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_historial_usuarios(2);
  reset role;
  if (jsonb_array_length(v_r -> 'eventos') = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el límite pedido debe recortar el historial'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_historial_usuarios(0);
  reset role;
  if (jsonb_array_length(v_r -> 'eventos') = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un límite de 0 se corrige a 1'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_historial_usuarios(null);
  reset role;
  if (jsonb_array_length(v_r -> 'eventos') >= 1 and jsonb_array_length(v_r -> 'eventos') <= 30) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sin límite, el historial trae como máximo 30 eventos'; end if;

  -- 10) lo que NO cambió
  if ((select count(*) from core.perfiles where es_admin_general) >= 1 and (select es_admin_general from core.perfiles where user_id = v_admin)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los administradores generales siguen igual'; end if;
  raise exception E'PRUEBAS DE LA FASE 5 · PARTE 9: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
