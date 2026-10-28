-- Prodmazul · Prueba de la migración 22 (Catálogo: eliminar y renombrar) EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Crea datos de prueba (ZZ EL ...) y NO deja nada guardado: termina a propósito con un mensaje rojo que trae el resultado.
-- RESULTADO ESPERADO: «PRUEBAS DE LA MIGRACIÓN 22: NN correctas, 0 con fallo.»

do $prueba$
declare
  v_admin uuid;
  v_op  uuid := gen_random_uuid();
  v_ok  integer := 0;
  v_mal integer := 0;
  v_txt text := '';
  v_e   text;
  v_r   jsonb;
  v_lib uuid; v_uso uuid; v_esp_lib uuid; v_esp_uso uuid;
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
  v_rec text;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then raise exception 'No hay ningún administrador general activo en core.perfiles.'; end if;
  insert into auth.users (id, email) values (v_op, 'zz-el-op@prueba.invalid');
  insert into core.usuario_modulo_rol (user_id, modulo_id, rol_id) values (v_op, 'M01', 'operativo');

  -- permisos de ejecución
  if has_function_privilege('authenticated', 'public.api_admin_catalogo_eliminar(text,uuid)', 'execute') and not has_function_privilege('anon', 'public.api_admin_catalogo_eliminar(text,uuid)', 'execute')
     and has_function_privilege('authenticated', 'public.api_admin_catalogo_renombrar(text,uuid,text)', 'execute') and not has_function_privilege('anon', 'public.api_admin_catalogo_renombrar(text,uuid,text)', 'execute')
  then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: permisos de eliminar/renombrar (¿falta la migración 22?)'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_lib := (public.api_admin_catalogo_crear('proveedores', 'ZZ EL Libre') ->> 'id')::uuid;
  v_uso := (public.api_admin_catalogo_crear('proveedores', 'ZZ EL Usado') ->> 'id')::uuid;
  v_esp_lib := (public.api_admin_catalogo_crear('especies', 'ZZ EL Especie Libre') ->> 'id')::uuid;
  v_esp_uso := (public.api_admin_catalogo_crear('especies', 'ZZ EL Especie Usada') ->> 'id')::uuid;
  v_r := public.api_m01_guardar_recepcion(jsonb_build_object('estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '961-961-961', 'proveedor', 'ZZ EL Usado', 'especie', 'ZZ EL Especie Usada', 'num_gavetas_bines', 2, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-EL-1', 'client_uuid', gen_random_uuid()));
  v_rec := v_r ->> 'recepcion_id';

  -- el listado informa «en_uso»
  if (select (i ->> 'en_uso')::boolean from jsonb_array_elements(public.api_admin_catalogo('{"tipo":"proveedores","busqueda":"ZZ EL"}') -> 'items') i where i ->> 'nombre' = 'ZZ EL Usado') is true
     and (select (i ->> 'en_uso')::boolean from jsonb_array_elements(public.api_admin_catalogo('{"tipo":"proveedores","busqueda":"ZZ EL"}') -> 'items') i where i ->> 'nombre' = 'ZZ EL Libre') is false
  then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el listado debe marcar en_uso true para el proveedor con recepción y false para el libre'; end if;
  if (select (i ->> 'en_uso')::boolean from jsonb_array_elements(public.api_admin_catalogo('{"tipo":"especies","busqueda":"ZZ EL"}') -> 'items') i where i ->> 'nombre' = 'ZZ EL Especie Usada') is true
     and (select (i ->> 'en_uso')::boolean from jsonb_array_elements(public.api_admin_catalogo('{"tipo":"especies","busqueda":"ZZ EL"}') -> 'items') i where i ->> 'nombre' = 'ZZ EL Especie Libre') is false
  then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el listado de especies debe marcar en_uso'; end if;

  -- eliminar uno en uso: se rechaza y sigue existiendo
  begin perform public.api_admin_catalogo_eliminar('proveedores', v_uso); v_e := null; exception when others then v_e := sqlerrm; end;
  if v_e like 'E_EN_USO|%' and exists (select 1 from core.proveedores where id = v_uso) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un proveedor con recepción no se puede eliminar (' || coalesce(v_e, 'sin error') || ')'; end if;
  begin perform public.api_admin_catalogo_eliminar('especies', v_esp_uso); v_e := null; exception when others then v_e := sqlerrm; end;
  if v_e like 'E_EN_USO|%' and exists (select 1 from core.especies where id = v_esp_uso) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una especie con recepción no se puede eliminar'; end if;

  -- una recepción eliminada (borrado lógico) o anulada también cuenta como uso
  update m01_recepcion.recepciones set estado = 'eliminado' where recepcion_id = v_rec;
  begin perform public.api_admin_catalogo_eliminar('proveedores', v_uso); v_e := null; exception when others then v_e := sqlerrm; end;
  if v_e like 'E_EN_USO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una recepción eliminada también debe impedir eliminar el proveedor'; end if;
  update m01_recepcion.recepciones set estado = 'cerrado' where recepcion_id = v_rec;

  -- eliminar los libres
  perform public.api_admin_catalogo_eliminar('proveedores', v_lib);
  if not exists (select 1 from core.proveedores where id = v_lib) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el proveedor libre debía eliminarse'; end if;
  perform public.api_admin_catalogo_eliminar('especies', v_esp_lib);
  if not exists (select 1 from core.especies where id = v_esp_lib) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la especie libre debía eliminarse'; end if;
  if (select count(*) from core.auditoria where accion in ('eliminar_proveedor', 'eliminar_especie') and detalle ->> 'nombre' in ('ZZ EL Libre', 'ZZ EL Especie Libre')) = 2
  then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cada eliminación debe quedar en la auditoría'; end if;
  begin perform public.api_admin_catalogo_eliminar('proveedores', v_lib); v_e := null; exception when others then v_e := sqlerrm; end;
  if v_e like 'E_NO_ENCONTRADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: eliminar dos veces debe decir que ya no existe'; end if;

  -- renombrar
  v_r := public.api_admin_catalogo_renombrar('proveedores', v_uso, '  ZZ EL   Renombrado ');
  if v_r ->> 'nombre' = 'ZZ EL Renombrado'
     and (select p.nombre from m01_recepcion.recepciones r join core.proveedores p on p.id = r.proveedor_id where r.recepcion_id = v_rec) = 'ZZ EL Renombrado'
     and (select nombre_normalizado from core.proveedores where id = v_uso) = core.normalizar('ZZ EL Renombrado')
  then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: renombrar cambia el nombre y la recepción lo muestra con el nombre nuevo'; end if;
  v_r := public.api_admin_catalogo_renombrar('especies', v_esp_uso, 'ZZ EL Especie Renombrada');
  if (select nombre from core.especies where id = v_esp_uso) = 'ZZ EL Especie Renombrada' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: renombrar especie'; end if;
  if (select count(*) from core.auditoria where accion in ('renombrar_proveedor', 'renombrar_especie') and detalle ->> 'despues' like 'ZZ EL%') = 2
  then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cada cambio de nombre queda en la auditoría con el nombre anterior y el nuevo'; end if;
  v_r := public.api_admin_catalogo_renombrar('proveedores', v_uso, 'zz el renombrado');
  if (select nombre from core.proveedores where id = v_uso) = 'ZZ EL Renombrado' or v_r ->> 'nombre' = 'zz el renombrado' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se puede cambiar solo mayúsculas del mismo nombre'; end if;

  -- renombrar a un nombre que ya existe o que fue unido
  perform public.api_admin_catalogo_crear('proveedores', 'ZZ EL Otro');
  begin perform public.api_admin_catalogo_renombrar('proveedores', v_uso, 'zz el otro'); v_e := null; exception when others then v_e := sqlerrm; end;
  if v_e like 'E_DUPLICADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: no se puede usar el nombre de otro proveedor (' || coalesce(v_e, 'sin error') || ')'; end if;
  insert into core.catalogo_alias (tipo, nombre_normalizado, nombre, destino_id) values ('proveedor', core.normalizar('ZZ EL Alias'), 'ZZ EL Alias', (select id from core.proveedores where nombre = 'ZZ EL Otro'));
  begin perform public.api_admin_catalogo_renombrar('proveedores', v_uso, 'ZZ EL Alias'); v_e := null; exception when others then v_e := sqlerrm; end;
  if v_e like 'E_DUPLICADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: no se puede usar un nombre que ya fue unido a otro'; end if;
  -- al eliminar un proveedor, sus alias se van con él
  perform public.api_admin_catalogo_eliminar('proveedores', (select id from core.proveedores where nombre = 'ZZ EL Otro'));
  if not exists (select 1 from core.catalogo_alias where nombre = 'ZZ EL Alias') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los alias del proveedor eliminado deben borrarse'; end if;

  -- validaciones
  begin perform public.api_admin_catalogo_renombrar('proveedores', v_uso, 'A'); v_e := null; exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un nombre de 1 letra no es válido'; end if;
  begin perform public.api_admin_catalogo_renombrar('proveedores', v_uso, repeat('x', 121)); v_e := null; exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un nombre de más de 120 letras no es válido'; end if;
  begin perform public.api_admin_catalogo_eliminar('otra', v_uso); v_e := null; exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: tipo de catálogo inválido'; end if;

  -- un usuario que no es administrador no puede
  perform set_config('request.jwt.claim.sub', v_op::text, true);
  begin perform public.api_admin_catalogo_renombrar('proveedores', v_uso, 'ZZ EL Intruso'); v_e := null; exception when others then v_e := sqlerrm; end;
  if v_e like 'E_PERMISO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario no administrador no puede renombrar'; end if;
  begin perform public.api_admin_catalogo_eliminar('especies', v_esp_uso); v_e := null; exception when others then v_e := sqlerrm; end;
  if v_e like 'E_PERMISO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario no administrador no puede eliminar'; end if;

  raise exception 'PRUEBAS DE LA MIGRACIÓN 22: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
