-- Prodmazul · Ajustes · Prueba de la migración 21 (gavetas opcionales y catálogo manual) EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Crea usuarios, lotes, recepciones y nombres de prueba (ZZ AJ) y comprueba las reglas nuevas. NO deja nada guardado:
-- al final se detiene a propósito con un mensaje de error que contiene el resultado (eso deshace TODOS los datos de prueba).
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LOS AJUSTES (MIGRACIÓN 21): NN correctas, 0 con fallo.»
-- Ese «error» es normal: es la forma de deshacer los datos de prueba.

do $prueba$
declare
  v_admin uuid;
  v_op  uuid := gen_random_uuid();   -- operativo
  v_ok  integer := 0;
  v_mal integer := 0;
  v_txt text := '';
  v_e   text;
  v_r   jsonb;
  v_id  uuid;
  v_rec text;
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;
  insert into auth.users (id, email) values (v_op, 'zz-aj-op@prueba.invalid');
  update core.perfiles set nombre = 'ZZ AJ Operativo' where user_id = v_op;
  insert into core.usuario_modulo_rol (user_id, modulo_id, rol_id) values (v_op, 'M01', 'operativo');
  if (has_function_privilege('authenticated', 'public.api_admin_catalogo_crear(text,text)', 'execute') and not has_function_privilege('anon', 'public.api_admin_catalogo_crear(text,text)', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: api_admin_catalogo_crear debe poder ejecutarla un usuario con sesión y no una persona anónima (¿falta la migración 21?)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  begin v_r := public.api_m01_guardar_recepcion(jsonb_build_object('estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '971-971-971', 'proveedor', 'ZZ AJ Proveedor Base', 'especie', 'ZZ AJ Entero', 'num_gavetas_bines', 2, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-AJ-1', 'client_uuid', gen_random_uuid())); v_e := null; exception when others then v_e := sqlerrm; v_r := null; end;
  reset role;
  if (v_e is null and v_r ->> 'estado' = 'cerrado') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se puede cerrar una recepción SIN pesar ninguna gaveta (mensaje: ' || coalesce(v_e,'') || ')'; end if;
  v_rec := v_r ->> 'recepcion_id';
  if ((select peso_promedio_lb from m01_recepcion.recepciones where recepcion_id = v_rec) is null and (select count(*) from m01_recepcion.recepcion_gavetas where recepcion_id = v_rec) = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sin gavetas pesadas no hay peso promedio ni filas de gavetas'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  begin v_r := public.api_m01_guardar_recepcion(jsonb_build_object('estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '971-971-972', 'proveedor', 'ZZ AJ Proveedor Base', 'especie', 'ZZ AJ Entero', 'num_gavetas_bines', 2, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-AJ-2', 'client_uuid', gen_random_uuid(), 'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 40)))); v_e := null; exception when others then v_e := sqlerrm; v_r := null; end;
  reset role;
  if (v_e is null and (select peso_promedio_lb from m01_recepcion.recepciones where recepcion_id = v_r ->> 'recepcion_id') = 40) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con una sola gaveta pesada el promedio es ese peso (la otra queda vacía)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  begin v_r := public.api_m01_guardar_recepcion(jsonb_build_object('estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '971-971-973', 'proveedor', 'ZZ AJ Proveedor Base', 'especie', 'ZZ AJ Entero', 'num_gavetas_bines', 2, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-AJ-3', 'client_uuid', gen_random_uuid(), 'temperaturas', jsonb_build_array(jsonb_build_object('lectura_id', 1, 'num_gaveta', 2, 'temperatura_c', -3)))); v_e := null; exception when others then v_e := sqlerrm; v_r := null; end;
  reset role;
  if (v_e is null and exists (select 1 from m01_recepcion.recepcion_temperaturas where recepcion_id = v_r ->> 'recepcion_id' and num_gaveta = 2 and temperatura_c = -3.0)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se puede guardar la temperatura de una gaveta sin peso'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  begin v_r := public.api_m01_guardar_recepcion(jsonb_build_object('estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '971-971-974', 'proveedor', 'ZZ AJ Proveedor Base', 'especie', 'ZZ AJ Entero', 'num_gavetas_bines', 2, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-AJ-4', 'client_uuid', gen_random_uuid(), 'temperaturas', jsonb_build_array(jsonb_build_object('lectura_id', 1, 'num_gaveta', 31, 'temperatura_c', 2)))); v_e := null; exception when others then v_e := sqlerrm; v_r := null; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la gaveta 31 no existe: se rechaza'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  begin v_r := public.api_m01_guardar_recepcion(jsonb_build_object('estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '971-971-975', 'proveedor', 'ZZ AJ Proveedor Base', 'especie', 'ZZ AJ Entero', 'num_gavetas_bines', 2, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-AJ-5', 'client_uuid', gen_random_uuid(), 'temperaturas', jsonb_build_array(jsonb_build_object('lectura_id', 1, 'num_gaveta', 2, 'temperatura_c', 2), jsonb_build_object('lectura_id', 2, 'num_gaveta', 2, 'temperatura_c', 3)))); v_e := null; exception when others then v_e := sqlerrm; v_r := null; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una gaveta solo puede tener una temperatura'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  begin v_r := public.api_m01_guardar_recepcion(jsonb_build_object('estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '971-971-976', 'proveedor', 'ZZ AJ Proveedor Base', 'especie', 'ZZ AJ Entero', 'num_gavetas_bines', 2, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-AJ-6', 'client_uuid', gen_random_uuid(), 'temperaturas', jsonb_build_array(jsonb_build_object('lectura_id', 1, 'temperatura_c', 2)))); v_e := null; exception when others then v_e := sqlerrm; v_r := null; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una temperatura sin gaveta se rechaza'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  begin v_r := public.api_m01_guardar_recepcion(jsonb_build_object('estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '971-971-977', 'proveedor', 'ZZ AJ Proveedor Base', 'especie', 'ZZ AJ Entero', 'num_gavetas_bines', 2, 'libras_reportadas', 70, 'libras_planta', 70, 'guia_remision', 'G-AJ-7', 'client_uuid', gen_random_uuid(), 'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 80)))); v_e := null; exception when others then v_e := sqlerrm; v_r := null; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: las libras no pueden ser menores que el peso de las gavetas (regla que se conserva)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  begin v_r := public.api_m01_guardar_recepcion(jsonb_build_object('estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '971-971-978', 'proveedor', 'ZZ AJ Proveedor Base', 'especie', 'ZZ AJ Entero', 'num_gavetas_bines', 2, 'libras_reportadas', null, 'guia_remision', 'G-AJ-8', 'client_uuid', gen_random_uuid())); v_e := null; exception when others then v_e := sqlerrm; v_r := null; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: para cerrar siguen siendo obligatorias las libras (regla que se conserva)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  begin v_r := public.api_m01_guardar_recepcion(jsonb_build_object('estado', 'borrador', 'fecha_llegada', v_hoy, 'lote_id', '971-971-979', 'proveedor', 'ZZ AJ Proveedor Base', 'especie', 'ZZ AJ Entero', 'num_gavetas_bines', 2, 'libras_reportadas', null, 'guia_remision', 'G-AJ-9', 'client_uuid', gen_random_uuid())); v_e := null; exception when others then v_e := sqlerrm; v_r := null; end;
  reset role;
  if (v_e is null and v_r ->> 'estado' = 'borrador') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un borrador sin gavetas ni libras se guarda'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_catalogo_crear('proveedores', '  zz aj   Proveedor Manual  ');
  reset role;
  if ((v_r ->> 'nombre') = 'zz aj Proveedor Manual' and exists (select 1 from core.proveedores where id = (v_r ->> 'id')::uuid and activo)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador crea un proveedor a mano (espacios sobrantes se limpian)'; end if;
  v_id := (v_r ->> 'id')::uuid;
  if (exists (select 1 from core.auditoria where accion = 'crear_proveedor' and entidad_id = v_id::text)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: crear un proveedor queda en la auditoría'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  begin v_r := public.api_admin_catalogo_crear('proveedores', 'ZZ AJ PROVEEDOR MANUAL'); v_e := null; exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_DUPLICADO%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el mismo nombre con otras mayúsculas se rechaza como repetido'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_catalogo_crear('especies', 'ZZ AJ Especie Manual');
  reset role;
  if (exists (select 1 from core.especies where id = (v_r ->> 'id')::uuid and nombre = 'ZZ AJ Especie Manual')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: también se crean especies'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  begin v_r := public.api_admin_catalogo_crear('proveedores', 'ZZ AJ Sin Permiso'); v_e := null; exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e is not null and not exists (select 1 from core.proveedores where nombre = 'ZZ AJ Sin Permiso')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario que no es administrador no puede crear nombres'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  begin v_r := public.api_admin_catalogo_crear('proveedores', 'A'); v_e := null; exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un nombre de 1 letra se rechaza'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  begin v_r := public.api_admin_catalogo_crear('clientes', 'ZZ AJ X'); v_e := null; exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_VALIDACION%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: solo se admiten proveedores y especies'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  begin v_r := public.api_m01_guardar_recepcion(jsonb_build_object('estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '971-971-980', 'proveedor', 'zz aj proveedor manual', 'especie', 'ZZ AJ Entero', 'num_gavetas_bines', 2, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-AJ-10', 'client_uuid', gen_random_uuid())); v_e := null; exception when others then v_e := sqlerrm; v_r := null; end;
  reset role;
  if (v_e is null and (select count(*) from core.proveedores where nombre_normalizado = core.normalizar('ZZ AJ Proveedor Manual')) = 1 and (select proveedor_id from m01_recepcion.recepciones where recepcion_id = v_r ->> 'recepcion_id') = v_id) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el proveedor creado a mano se usa en una recepción sin crear un duplicado'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_admin_catalogo_crear('proveedores', 'ZZ AJ Proveedor Base 2');
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  perform public.api_admin_catalogo_unir('proveedores', (v_r ->> 'id')::uuid, v_id, 'prueba de unión de nombres');
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  begin v_r := public.api_admin_catalogo_crear('proveedores', 'zz aj proveedor base 2'); v_e := null; exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e like 'E_DUPLICADO%unido%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un nombre que ya se unió a otro no se vuelve a crear'; end if;
  if (exists (select 1 from core.sync_cola where tabla = 'core.proveedores' and clave_json ->> 'id' = v_id::text)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el proveedor nuevo queda en la cola del respaldo de Google'; end if;
  raise exception E'PRUEBAS DE LOS AJUSTES (MIGRACIÓN 21): % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
