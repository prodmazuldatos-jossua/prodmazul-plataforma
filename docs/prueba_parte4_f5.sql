-- Prodmazul · Fase 5 · Parte 4 · Prueba de la migración 15 (respaldo de fotos en Drive) EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Comprueba la estructura, la seguridad y el ciclo de una foto: pendiente → reservada → error/reintento → respaldada → repetir.
-- NO toca Drive ni Storage, y no deja nada guardado: crea una recepción y fotos de prueba y, al final, se detiene a propósito
-- con un mensaje de error que contiene el resultado (eso deshace TODOS los datos de prueba).
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA FASE 5 · PARTE 4: NN correctas, 0 con fallo.»
-- Ese «error» es normal: es la forma de deshacer los datos de prueba.

do $prueba$
declare
  v_admin uuid;
  v_op    uuid;
  v_ok    integer := 0;
  v_mal   integer := 0;
  v_txt   text := '';
  v_e     text;
  v_r     jsonb;
  v_n     bigint;
  v_rid   text;
  v_id    bigint;
  v_prov  text := 'ZZ PRUEBA F5P4 ' || substr(md5(random()::text), 1, 6);
  v_esp   text;
  v_f1    text; v_f2 text; v_f3 text; v_f4 text;
  v_max   integer;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;
  select p.user_id into v_op from core.perfiles p join core.usuario_modulo_rol r using (user_id)
   where p.activo and not p.es_admin_general and r.modulo_id = 'M01' and r.rol_id in ('operativo', 'consulta') limit 1;
  v_esp := 'ZZ ESPECIE F5P4';
  v_max := core.sync_cfg_int('sync_max_intentos', 5);
  delete from core.sync_fotos;

  -- 1) estructura

  if ((select relrowsecurity from pg_class where oid = 'core.sync_fotos'::regclass)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: existe la tabla de control de fotos con la seguridad por filas activa '; end if;
  if ((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname, p.proname) in (('public','sync_fotos_pendientes'),('public','sync_foto_marcar_ok'),('public','sync_foto_marcar_error'),('core','sync_fotos_olvidar'))) = 4) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: existen las 4 funciones nuevas de fotos '; end if;
  if ((select count(*) from information_schema.columns where (table_schema, table_name, column_name) in (('core','sync_estado','fotos_respaldadas'),('core','sync_estado','ultimo_error_foto'),('core','sync_ejecuciones','fotos'),('core','sync_ejecuciones','fotos_error'),('core','sync_ejecuciones','quedan_fotos'))) = 5) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el estado y las ejecuciones tienen las columnas de fotos '; end if;
  if (not exists (select 1 from m01_recepcion.fotos_meta where (drive_file_id is null) <> (respaldo_drive_en is null))) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: las fotos ya respaldadas antes de esta parte siguen intactas (no hay fotos con respaldo sin fecha) '; end if;

  -- 2) seguridad
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform count(*) from core.sync_fotos; exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede leer el control de fotos '; end if;
  v_e := null; begin perform public.sync_fotos_pendientes(5); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede pedir fotos pendientes (función interna) '; end if;
  v_e := null; begin perform public.sync_foto_marcar_ok('x', 'abcdefghij123'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede marcar una foto como respaldada '; end if;
  v_e := null; begin perform public.sync_foto_marcar_error('x', 'e'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede marcar el error de una foto '; end if;
  v_e := null; begin perform core.sync_fotos_olvidar('x'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede borrar el respaldo de una foto '; end if;
  v_e := null; begin v_r := public.api_sync_estado(); exception when others then v_e := sqlerrm; end;
  if (v_e is null and v_r ? 'fotos_sin_respaldo' and v_r ? 'fotos_respaldadas' and v_r ? 'fotos_agotadas' and v_r ? 'fotos_con_error') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador general SÍ ve el estado con las cifras de fotos ' || coalesce(v_e, '(no dio error)'); end if;
  reset role;
  if v_op is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_e := null; begin perform public.api_sync_estado(); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_PERMISO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo NO ve el estado de la sincronización ' || coalesce(v_e, '(no dio error)'); end if;
    reset role;
  else v_ok := v_ok + 1; end if;

  -- 3) datos de prueba: una recepción con 4 fotos (3 confirmadas y 1 sin confirmar)
  insert into core.proveedores (nombre, nombre_normalizado) values (v_prov, lower(v_prov));

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_guardar_recepcion(jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', current_date, 'lote_id', '995-995-995', 'proveedor', v_prov, 'especie', v_esp,
    'num_gavetas_bines', 1, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-F5P4',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 99)),
    'client_uuid', gen_random_uuid()));
  v_rid := v_r->>'recepcion_id';
  reset role;
  if (v_rid is not null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se guardó la recepción de prueba '; end if;
  v_f1 := 'FOT-M01-995-995-995-' || v_rid || '-01'; v_f2 := 'FOT-M01-995-995-995-' || v_rid || '-02';
  v_f3 := 'FOT-M01-995-995-995-' || v_rid || '-03'; v_f4 := 'FOT-M01-995-995-995-' || v_rid || '-04';
  select count(*) into v_n from m01_recepcion.fotos_meta where confirmada and drive_file_id is null and purgada_supabase_en is null;
  insert into m01_recepcion.fotos_meta (foto_id, recepcion_id, lote_id, nn, ruta, nombre, tipo_mime, tamano_bytes, confirmada) values
    (v_f1, v_rid, '995-995-995', 1, 'M01/995-995-995/' || v_rid || '/' || v_f1 || '-zz1.jpg', 'f.jpg', 'image/jpeg', 1000, true),
    (v_f2, v_rid, '995-995-995', 2, 'M01/995-995-995/' || v_rid || '/' || v_f2 || '-zz2.jpg', 'f.jpg', 'image/jpeg', 2000, true),
    (v_f3, v_rid, '995-995-995', 3, 'M01/995-995-995/' || v_rid || '/' || v_f3 || '-zz3.jpg', 'f.jpg', 'image/png', 3000, true),
    (v_f4, v_rid, '995-995-995', 4, 'M01/995-995-995/' || v_rid || '/' || v_f4 || '-zz4.jpg', 'f.jpg', 'image/webp', 4000, false);

  -- 4) detectar pendientes
  v_r := public.sync_fotos_pendientes(1000);

  if ((select count(*) from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' in (v_f1, v_f2, v_f3)) = 3 and not exists (select 1 from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' = v_f4)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: detecta las 3 fotos confirmadas y NO la sin confirmar '; end if;
  if ((v_r->>'pendientes_total')::bigint = v_n + 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la cuenta total sube exactamente en 3 '; end if;
  if ((select bool_and(x->>'ruta' like 'M01/995-995-995/%' and x->>'tipo_mime' is not null and (x->>'nn')::int between 1 and 5 and (x->>'bytes_esperados')::bigint > 0 and (x->>'intento')::int = 1) from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' in (v_f1, v_f2, v_f3))) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: entrega ruta, tipo, número y tamaño de cada foto '; end if;
  v_r := public.sync_fotos_pendientes(1000);
  if (not exists (select 1 from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' in (v_f1, v_f2, v_f3))) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: mientras están reservadas no se entregan otra vez '; end if;
  update core.sync_fotos set reservado_hasta = now() - interval '1 minute' where foto_id in (v_f1, v_f2, v_f3);
  v_r := public.sync_fotos_pendientes(1000);
  if ((select count(*) from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' in (v_f1, v_f2, v_f3) and (x->>'intento')::int = 2) = 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: al vencer la reserva se entregan de nuevo con el intento contado (2) '; end if;

  -- 5) error y reintento
  v_r := public.sync_foto_marcar_error(v_f1, 'Google: descarga fallida');
  if ((v_r->>'intentos')::int = 2 and not (v_r->>'agotada')::boolean and (select drive_file_id is null from m01_recepcion.fotos_meta where foto_id = v_f1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un error deja el intento contado y no la marca como respaldada '; end if;
  if ((select ultimo_error = 'Google: descarga fallida' and proximo_intento_en > now() + interval '10 minutes' and reservado_hasta is null from core.sync_fotos where foto_id = v_f1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el error queda guardado con una espera antes de reintentar '; end if;
  if ((select ultimo_error_foto = 'Google: descarga fallida' and ultimo_error_foto_en is not null from core.sync_estado where id = 1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el estado muestra el último error de fotos '; end if;
  v_r := public.sync_fotos_pendientes(1000);
  if (not exists (select 1 from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' = v_f1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: durante la espera esa foto no se vuelve a entregar '; end if;
  v_e := null; begin perform public.sync_foto_marcar_error('FOT-NO-EXISTE', 'x'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_NO_ENCONTRADO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: marcar el error de una foto que no estaba reservada se rechaza ' || coalesce(v_e, '(no dio error)'); end if;
  update core.sync_fotos set intentos = v_max where foto_id = v_f1;
  if ((select count(*) from jsonb_array_elements(public.sync_fotos_pendientes(1000)->'fotos') x where x->>'foto_id' = v_f1) = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con el máximo de intentos queda «agotada» y deja de entregarse '; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_sync_estado();
  reset role;
  if ((v_r->>'fotos_agotadas')::int >= 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador ve al menos 1 foto agotada '; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_sync_reintentar_errores();
  reset role;
  if ((v_r->>'fotos')::int >= 1 and (select intentos = 0 and proximo_intento_en is null from core.sync_fotos where foto_id = v_f1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: «reintentar errores» reactiva las fotos agotadas '; end if;

  -- 6) respaldo confirmado por Drive
  v_e := null; begin perform public.sync_foto_marcar_ok(v_f1, 'corto'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_DATOS|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un identificador de Drive inválido se rechaza ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.sync_foto_marcar_ok(v_f1, 'abc def ghi jkl'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_DATOS|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un identificador de Drive con espacios se rechaza ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.sync_foto_marcar_ok('FOT-NO-EXISTE', '1AbCdEfGhIjKlMn'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_NO_ENCONTRADO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: marcar una foto que no existe se rechaza ' || coalesce(v_e, '(no dio error)'); end if;
  if ((select drive_file_id is null and respaldo_drive_en is null from m01_recepcion.fotos_meta where foto_id = v_f1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: lo rechazado no marcó nada '; end if;
  v_r := public.sync_foto_marcar_ok(v_f1, '1AbCdEfGhIjKlMn_-xyz', 1000);
  if (not (v_r->>'ya_respaldada')::boolean and (select drive_file_id = '1AbCdEfGhIjKlMn_-xyz' and respaldo_drive_en is not null from m01_recepcion.fotos_meta where foto_id = v_f1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con la confirmación de Drive se guarda el identificador y la fecha '; end if;
  if (not exists (select 1 from core.sync_fotos where foto_id = v_f1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la foto sale del control de pendientes '; end if;
  if (exists (select 1 from core.auditoria where accion = 'respaldar_foto' and detalle->>'foto_id' = v_f1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: queda en la auditoría '; end if;
  v_r := public.sync_foto_marcar_ok(v_f1, 'OTRO_ID_DIFERENTE_99');
  if ((v_r->>'ya_respaldada')::boolean and (select drive_file_id = '1AbCdEfGhIjKlMn_-xyz' from m01_recepcion.fotos_meta where foto_id = v_f1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: confirmar otra vez no cambia el identificador (no duplica) '; end if;
  if (not exists (select 1 from jsonb_array_elements(public.sync_fotos_pendientes(1000)->'fotos') x where x->>'foto_id' = v_f1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la foto respaldada ya no aparece como pendiente '; end if;
  if (exists (select 1 from core.sync_cola where tabla = 'm01_recepcion.fotos_meta' and clave_json->>'foto_id' = v_f1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el cambio se anotó para el espejo en Sheets '; end if;

  -- 7) repetir el respaldo de una foto
  v_e := null; v_r := to_jsonb(core.sync_fotos_olvidar(v_f1));
  if ((select drive_file_id is null and respaldo_drive_en is null from m01_recepcion.fotos_meta where foto_id = v_f1) and v_r = 'true'::jsonb) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: «olvidar» deja la foto otra vez sin respaldo '; end if;
  if (exists (select 1 from jsonb_array_elements(public.sync_fotos_pendientes(1000)->'fotos') x where x->>'foto_id' = v_f1)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: y vuelve a aparecer como pendiente '; end if;
  if (core.sync_fotos_olvidar('FOT-NO-EXISTE') = false) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: olvidar una foto inexistente devuelve falso '; end if;

  -- 8) fotos purgadas y borradas
  update m01_recepcion.fotos_meta set purgada_supabase_en = now() where foto_id = v_f2;
  delete from core.sync_fotos;
  if (not exists (select 1 from jsonb_array_elements(public.sync_fotos_pendientes(1000)->'fotos') x where x->>'foto_id' = v_f2)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una foto ya purgada de Supabase no se intenta respaldar '; end if;
  delete from m01_recepcion.fotos_meta where foto_id = v_f3;
  if (not exists (select 1 from core.sync_fotos where foto_id = v_f3)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: borrar una foto limpia su control de pendientes '; end if;

  -- 9) registro de ejecuciones con fotos
  delete from core.sync_ejecuciones;
  v_id := public.sync_ejecucion_abrir(null, 'manual');
  v_r := public.sync_ejecucion_cerrar(v_id, 'ok', 1, 10, null, 3, 1);
  if ((select fotos = 3 and fotos_error = 1 and quedan_fotos is not null from core.sync_ejecuciones where ejecucion_id = v_id) and v_r ? 'quedan_fotos') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cerrar guarda cuántas fotos se respaldaron y cuántas fallaron '; end if;
  v_id := public.sync_ejecucion_abrir(null, 'manual');
  v_r := public.sync_ejecucion_cerrar(v_id, 'ok', 0, 0, null);
  if ((select fotos = 0 and fotos_error = 0 from core.sync_ejecuciones where ejecucion_id = v_id)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la forma antigua de cerrar (sin fotos) sigue funcionando '; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_sync_ejecuciones(5);
  reset role;
  if ((v_r->'ejecuciones'->0) ? 'fotos' and (v_r->'ejecuciones'->0) ? 'quedan_fotos') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la lista de ejecuciones del administrador incluye las fotos '; end if;

  raise exception E'PRUEBAS DE LA FASE 5 · PARTE 4: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
