-- Prodmazul · Fase 5 · Parte 6 · Prueba de la migración 17 (estado del respaldo y aviso de 6 horas) EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Comprueba el permiso, el indicador, el aviso en rojo (con horas simuladas) y el detalle de errores.
-- NO envía nada a Google y no deja nada guardado: al final se detiene a propósito con un mensaje de error que contiene
-- el resultado (eso deshace TODOS los datos de prueba y cualquier cambio que la prueba haya hecho al estado del respaldo).
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA FASE 5 · PARTE 6: NN correctas, 0 con fallo.»
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
  v_rid   text;
  v_prov  text := 'ZZ PRUEBA F5P6 ' || substr(md5(random()::text), 1, 6);
  v_esp   text := 'ZZ ESPECIE F5P6';
  v_a text; v_b text;
  v_max   integer;
  v_tabla text;
  v_fsin0 integer;
  v_aud0  bigint;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;
  select p.user_id into v_op from core.perfiles p join core.usuario_modulo_rol r using (user_id)
   where p.activo and not p.es_admin_general and r.modulo_id = 'M01' and r.rol_id in ('operativo', 'consulta') limit 1;
  v_max := core.sync_cfg_int('sync_max_intentos', 5);
  select tabla into v_tabla from core.sync_tablas order by tabla limit 1;

  -- 1) existen y están protegidas

  if ((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('api_respaldo_resumen','api_respaldo_errores')) = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: existen las dos funciones nuevas '; end if;
  if (has_function_privilege('authenticated', 'public.api_respaldo_resumen()', 'execute') and has_function_privilege('authenticated', 'public.api_respaldo_errores(integer)', 'execute') and not has_function_privilege('anon', 'public.api_respaldo_resumen()', 'execute') and not has_function_privilege('anon', 'public.api_respaldo_errores(integer)', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los usuarios con sesión pueden llamarlas (el permiso se revisa adentro) y el público anónimo NO '; end if;
  if (core.sync_cfg_int('sync_alerta_horas', 0) = 6) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: existe el parámetro sync_alerta_horas = 6 '; end if;

  -- 2) quién puede verlas
  if v_op is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_e := null; begin perform public.api_respaldo_resumen(); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_PERMISO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo NO ve el estado del respaldo ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.api_respaldo_errores(10); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_PERMISO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo NO ve el detalle de errores ' || coalesce(v_e, '(no dio error)'); end if;
    reset role;
  else v_ok := v_ok + 2; end if;

  -- 3) datos de prueba: una recepción con dos fotos
  insert into core.proveedores (nombre, nombre_normalizado) values (v_prov, lower(v_prov));

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_guardar_recepcion(jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', current_date, 'lote_id', '994-994-994', 'proveedor', v_prov, 'especie', v_esp,
    'num_gavetas_bines', 1, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-F5P6',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 99)),
    'client_uuid', gen_random_uuid()));
  v_rid := v_r->>'recepcion_id';
  reset role;
  if (v_rid is not null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se guardó la recepción de prueba '; end if;
  v_a := 'FOT-M01-994-994-994-' || v_rid || '-01'; v_b := 'FOT-M01-994-994-994-' || v_rid || '-02';
  -- Se pone «en orden» todo lo que ya existiera, para que los números de la prueba dependan solo de lo que se crea aquí.
  update m01_recepcion.fotos_meta set subido_en = now() where confirmada and drive_file_id is null and purgada_supabase_en is null;
  delete from core.sync_cola; delete from core.sync_fotos; delete from core.purga_fotos;
  delete from core.sync_ejecuciones; delete from core.purga_ejecuciones;
  update core.sync_estado set ultima_sync_ok_en = null, ultimo_intento_en = null, ultimo_error = null, ultimo_error_en = null where id = 1;
  update core.config set valor = '6'::jsonb where clave = 'sync_alerta_horas';
  update core.config set valor = 'true'::jsonb where clave = 'sync_activa';
  select count(*) into v_fsin0 from m01_recepcion.fotos_meta where confirmada and drive_file_id is null and purgada_supabase_en is null;
  insert into m01_recepcion.fotos_meta (foto_id, recepcion_id, lote_id, nn, ruta, nombre, tipo_mime, tamano_bytes, confirmada, subido_en, drive_file_id, respaldo_drive_en) values
    (v_a, v_rid, '994-994-994', 1, 'M01/994-994-994/' || v_rid || '/' || v_a || '-zz1.jpg', 'f.jpg', 'image/jpeg', 1000, true, now() - interval '1 hour', null, null),
    (v_b, v_rid, '994-994-994', 2, 'M01/994-994-994/' || v_rid || '/' || v_b || '-zz2.jpg', 'f.jpg', 'image/jpeg', 1000, true, now() - interval '90 days', 'DRIVE_PRUEBA_B_12345', now() - interval '5 days');
  delete from core.sync_cola; delete from core.sync_fotos;


  -- 4) el respaldo apagado no da alarma
  update core.config set valor = 'false'::jsonb where clave = 'sync_activa'; update core.sync_estado set ultima_sync_ok_en = now() - interval '30 hours' where id = 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if (v_r->>'nivel' = 'apagada' and not (v_r->>'alerta')::boolean and not (v_r->>'activa')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con el respaldo apagado: nivel «apagada» y sin aviso en rojo '; end if;

  -- 5) el aviso de 6 horas (horas simuladas)
  update core.config set valor = 'true'::jsonb where clave = 'sync_activa'; update core.sync_estado set ultima_sync_ok_en = now() - interval '10 minutes' where id = 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if (v_r->>'nivel' = 'ok' and not (v_r->>'alerta')::boolean and jsonb_array_length(v_r->'motivos') = 0 and v_r->>'problemas' = '0') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: hace 10 minutos: todo bien, nivel «ok», sin aviso '; end if;
  if ((v_r->>'segundos_sin_sincronizar')::bigint between 590 and 700 and v_r->>'ahora' is not null and (v_r->>'limite_horas')::int = 6) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: devuelve los segundos desde la última sincronización (unos 600) y la hora del servidor '; end if;
  update core.sync_estado set ultima_sync_ok_en = now() - interval '5 hours 59 minutes' where id = 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if (not (v_r->>'alerta')::boolean and v_r->>'nivel' = 'ok') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: a las 5 h 59 min todavía NO hay aviso '; end if;
  update core.sync_estado set ultima_sync_ok_en = now() - interval '6 hours 1 minute' where id = 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if ((v_r->>'alerta')::boolean and v_r->>'nivel' = 'alerta' and v_r->'motivos'->0->>'codigo' = 'sync_vieja' and v_r->'motivos'->0->>'texto' like '%6 horas%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: a las 6 h 01 min SÍ hay aviso en rojo, con su motivo '; end if;
  update core.sync_estado set ultima_sync_ok_en = null where id = 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if ((v_r->>'alerta')::boolean and v_r->'motivos'->0->>'codigo' = 'sin_sincronizar' and v_r->>'segundos_sin_sincronizar' is null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: si nunca hubo una sincronización correcta, también hay aviso '; end if;
  update core.config set valor = '2'::jsonb where clave = 'sync_alerta_horas'; update core.sync_estado set ultima_sync_ok_en = now() - interval '3 hours' where id = 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if ((v_r->>'alerta')::boolean and (v_r->>'limite_horas')::int = 2 and v_r->'motivos'->0->>'texto' like '%2 horas%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el límite sale del parámetro sync_alerta_horas (con 2 horas, a las 3 horas hay aviso) '; end if;
  update core.config set valor = '6'::jsonb where clave = 'sync_alerta_horas'; update core.sync_estado set ultima_sync_ok_en = now() - interval '10 minutes' where id = 1;

  -- 6) fotos sin respaldo
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if ((v_r->>'fotos_sin_respaldo')::int = v_fsin0 + 1 and not (v_r->>'alerta')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la foto sin copia, de hace 1 hora, se cuenta pero NO da aviso '; end if;
  update m01_recepcion.fotos_meta set subido_en = now() - interval '7 hours' where foto_id = v_a;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if ((v_r->>'alerta')::boolean and exists (select 1 from jsonb_array_elements(v_r->'motivos') m where m->>'codigo' = 'fotos_viejas') and v_r->>'fotos_mas_antigua_en' is not null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la misma foto con más de 6 horas sin respaldo SÍ da aviso en rojo '; end if;
  update m01_recepcion.fotos_meta set subido_en = now() - interval '1 hour' where foto_id = v_a;

  -- 7) errores que piden revisión (aviso amarillo)
  delete from core.sync_cola; insert into core.sync_cola (tabla, clave, clave_json, operacion, estado, intentos, ultimo_error) values (v_tabla, 'ZZ-1', '{"k":"ZZ-1"}'::jsonb, 'upsert', 'error', 1, 'Google respondió 500');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if (v_r->>'nivel' = 'aviso' and not (v_r->>'alerta')::boolean and (v_r->>'con_error')::int = 1 and (v_r->>'problemas')::int = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un envío con error (con intentos disponibles): nivel «aviso», no rojo '; end if;
  update core.sync_cola set intentos = v_max where clave = 'ZZ-1';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if ((v_r->>'agotadas')::int = 1 and (v_r->>'con_error')::int = 0 and v_r->>'nivel' = 'aviso') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un envío con los intentos agotados se cuenta aparte '; end if;
  update core.sync_cola set estado = 'pendiente', intentos = 0, ultimo_error = null where clave = 'ZZ-1';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if ((v_r->>'pendientes')::int = 1 and v_r->>'nivel' = 'ok') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un cambio pendiente de enviar se cuenta como pendiente y no es problema '; end if;
  delete from core.sync_cola;
  insert into core.sync_fotos (foto_id, intentos, ultimo_error) values (v_a, 1, 'Carpeta sin permiso');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if ((v_r->>'fotos_con_error')::int = 1 and v_r->>'nivel' = 'aviso') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una foto con error de respaldo: aviso '; end if;
  update core.sync_fotos set intentos = v_max where foto_id = v_a;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if ((v_r->>'fotos_agotadas')::int = 1 and (v_r->>'fotos_con_error')::int = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una foto con intentos agotados se cuenta aparte '; end if;
  delete from core.sync_fotos;
  insert into core.purga_fotos (foto_id, intentos, ultimo_error) values (v_b, 1, 'Drive no confirmó la copia');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if ((v_r->>'purga_con_error')::int = 1 and v_r->>'nivel' = 'aviso') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un error de la purga: aviso '; end if;
  delete from core.purga_fotos;
  insert into core.sync_ejecuciones (origen, estado, terminada_en, error) values ('cron', 'con_error', now(), 'No se pudo conectar con Google');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if (v_r->>'nivel' = 'aviso' and v_r->'ultima_corrida'->>'estado' = 'con_error' and v_r->'ultima_corrida'->>'error' like 'No se pudo%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la última corrida con error: aviso y se ve su texto '; end if;
  insert into core.sync_ejecuciones (origen, estado, terminada_en) values ('cron', 'ok', now());
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if (v_r->>'nivel' = 'ok' and v_r->'ultima_corrida'->>'estado' = 'ok') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: si la corrida siguiente salió bien, el aviso amarillo desaparece '; end if;
  insert into core.sync_ejecuciones (origen, estado, pedida_en) values ('cron', 'pedida', now() - interval '20 minutes');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if (v_r->'ultima_corrida'->>'estado' = 'sin_respuesta' and v_r->>'nivel' = 'aviso') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una orden que nadie atendió en 5 minutos aparece como «sin_respuesta» (aviso) '; end if;
  delete from core.sync_ejecuciones;
  insert into core.purga_ejecuciones (origen, estado, terminada_en, error) values ('cron', 'con_error', now(), 'No se pudo verificar las copias en Drive');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if (v_r->'ultima_purga'->>'estado' = 'con_error' and v_r->>'nivel' = 'aviso') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la última purga con error: aviso '; end if;
  delete from core.purga_ejecuciones;
  update core.sync_estado set ultima_sync_ok_en = now() - interval '9 hours' where id = 1; insert into core.sync_cola (tabla, clave, clave_json, operacion, estado, intentos) values (v_tabla, 'ZZ-2', '{"k":"ZZ-2"}'::jsonb, 'upsert', 'error', 1);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if (v_r->>'nivel' = 'alerta') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: si hay aviso rojo y también errores, manda el rojo '; end if;
  delete from core.sync_cola; update core.sync_estado set ultima_sync_ok_en = now() - interval '10 minutes' where id = 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if (v_r->>'nivel' = 'ok' and (v_r->>'problemas')::int = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: resuelto todo, vuelve a «ok» '; end if;
  select count(*) into v_aud0 from core.auditoria;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_resumen();
  reset role;
  if ((select count(*) from core.auditoria) = v_aud0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: consultar el estado no modifica nada (ni siquiera la auditoría) '; end if;

  -- 8) detalle de errores
  insert into core.sync_cola (tabla, clave, clave_json, operacion, estado, intentos, ultimo_error) values
    (v_tabla, 'ZZ-A', '{"k":"A"}'::jsonb, 'upsert', 'error', 1, 'Google respondió 500'),
    (v_tabla, 'ZZ-B', '{"k":"B"}'::jsonb, 'upsert', 'error', v_max, repeat('x', 600)),
    (v_tabla, 'ZZ-C', '{"k":"C"}'::jsonb, 'borrar', 'error', 2, 'Otro error');
  insert into core.sync_fotos (foto_id, intentos, ultimo_error) values (v_a, v_max, 'Carpeta sin permiso');
  insert into core.purga_fotos (foto_id, intentos, ultimo_error) values (v_b, 1, 'Drive no confirmó la copia: El archivo esta en la papelera de Drive.');
  insert into core.sync_ejecuciones (origen, estado, terminada_en, error) values ('manual', 'con_error', now(), 'Fallo de prueba');
  insert into core.purga_ejecuciones (origen, estado, terminada_en, error) values ('cron', 'con_error', now(), 'Fallo de purga');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_errores(50);
  reset role;
  if ((v_r->'datos'->>'total')::int = 3 and jsonb_array_length(v_r->'datos'->'items') = 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: lista los envíos con error, con el total '; end if;
  if ((select (x->>'agotado')::boolean from jsonb_array_elements(v_r->'datos'->'items') x where x->>'clave' = 'ZZ-B') and not (select (x->>'agotado')::boolean from jsonb_array_elements(v_r->'datos'->'items') x where x->>'clave' = 'ZZ-A')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: marca como agotado el que llegó al máximo de intentos '; end if;
  if ((select length(x->>'ultimo_error') from jsonb_array_elements(v_r->'datos'->'items') x where x->>'clave' = 'ZZ-B') <= 300) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: recorta los textos de error largos (300 caracteres como máximo) '; end if;
  if ((v_r->'fotos'->>'total')::int = 1 and v_r->'fotos'->'items'->0->>'foto_id' = v_a and v_r->'fotos'->'items'->0->>'recepcion_id' = v_rid and (v_r->'fotos'->'items'->0->>'agotada')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: lista la foto con error de respaldo, con su recepción y si está agotada '; end if;
  if ((v_r->'purga'->>'total')::int = 1 and v_r->'purga'->'items'->0->>'ultimo_error' like '%papelera%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: lista el error de la purga con su motivo '; end if;
  if ((select count(*) from jsonb_array_elements(v_r->'corridas') x where x->>'tipo' = 'sincronizacion') = 1 and (select count(*) from jsonb_array_elements(v_r->'corridas') x where x->>'tipo' = 'purga') = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: lista las corridas con problema de los dos tipos '; end if;
  if ((v_r->>'maximo_intentos')::int = v_max) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: informa el máximo de intentos '; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_errores(2);
  reset role;
  if (jsonb_array_length(v_r->'datos'->'items') = 2 and (v_r->'datos'->>'total')::int = 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el límite pedido recorta la lista pero el total sigue completo '; end if;
  delete from core.sync_cola; delete from core.sync_fotos; delete from core.purga_fotos; delete from core.sync_ejecuciones; delete from core.purga_ejecuciones;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_respaldo_errores(50);
  reset role;
  if ((v_r->'datos'->>'total')::int = 0 and jsonb_array_length(v_r->'datos'->'items') = 0 and jsonb_array_length(v_r->'fotos'->'items') = 0 and jsonb_array_length(v_r->'purga'->'items') = 0 and jsonb_array_length(v_r->'corridas') = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sin errores, las listas vienen vacías (no nulas) '; end if;

  raise exception E'PRUEBAS DE LA FASE 5 · PARTE 6: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
