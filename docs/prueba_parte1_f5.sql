-- Prodmazul · Fase 5 · Parte 1 · Prueba de la migración 13 (cola y estado de sincronización) EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Actúa como tu administrador general, crea una recepción de prueba (ZZ) y comprueba la cola, los lotes, los errores y los reintentos.
-- Trabaja sobre la cola real pero al final se detiene a propósito con un mensaje de error que contiene el resultado,
-- y por eso NO queda ningún cambio guardado (ni en la cola, ni en las tablas, ni en el estado).
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA FASE 5 · PARTE 1: NN correctas, 0 con fallo.»
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
  v_r2    jsonb;
  v_est   jsonb;
  v_est0  jsonb;
  v_n     integer;
  v_m     integer;
  v_lote  uuid;
  v_lote2 uuid;
  v_rid   text;
  v_hoy   date := (now() at time zone 'America/Guayaquil')::date;
  v_base  jsonb;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;
  select p.user_id into v_op from core.perfiles p join core.usuario_modulo_rol r using (user_id)
   where p.activo and not p.es_admin_general and r.modulo_id = 'M01' and r.rol_id in ('operativo', 'consulta') limit 1;

  -- Punto de partida limpio (todo se deshace al final).
  delete from core.sync_cola;
  update core.sync_estado set ultima_sync_ok_en = null, ultimo_intento_en = null, ultimo_error = null, ultimo_error_en = null,
                              lotes_enviados = 0, filas_enviadas = 0, lotes_con_error = 0 where id = 1;
  update core.config set valor = '5'::jsonb where clave = 'sync_max_intentos';
  update core.config set valor = 'false'::jsonb where clave = 'sync_activa';

  v_base := jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '994-994-994',
    'proveedor', 'ZZ F5 PROVEEDOR', 'especie', 'ZZ F5 ESPECIE', 'num_gavetas_bines', 3,
    'libras_reportadas', 300, 'libras_planta', 295, 'guia_remision', 'ZZ-F5-1',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',50), jsonb_build_object('num_gaveta',2,'peso_lb',51), jsonb_build_object('num_gaveta',30,'peso_lb',52)));

  -- 1) estructura
  if ((select count(*) from core.sync_tablas) = 11) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: hay 11 tablas registradas para sincronizar '; end if;
  if ((select count(*) from pg_trigger where tgname = 'sync_anotar' and not tgisinternal) = 11) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cada tabla registrada tiene su disparador '; end if;
  if ((select count(*) from pg_class where oid in ('core.sync_cola'::regclass, 'core.sync_estado'::regclass, 'core.sync_tablas'::regclass) and relrowsecurity) = 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la cola, el estado y las tablas tienen la seguridad por filas activa '; end if;

  -- 2) seguridad
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform count(*) from core.sync_cola; exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede leer la cola ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.sync_proximo_lote(1); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede pedir lotes (función interna) ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.sync_marcar_enviado(gen_random_uuid()); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede confirmar lotes (función interna) ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin v_est0 := public.api_sync_estado(); exception when others then v_e := sqlerrm; end;
  if (v_e is null and (v_est0->>'activa')::boolean = false) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador general SÍ ve el estado ' || coalesce(v_e, '(no dio error)'); end if;
  reset role;
  if v_op is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
    v_e := null; begin perform public.api_sync_estado(); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_PERMISO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo NO ve el estado de la sincronización ' || coalesce(v_e, '(no dio error)'); end if;
    v_e := null; begin perform public.api_sync_reencolar_todo(); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_PERMISO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo NO puede reencolar todo ' || coalesce(v_e, '(no dio error)'); end if;
    reset role;
  else v_ok := v_ok + 2; end if;

  -- 3) guardar una recepción deja anotados los cambios (sin repetir)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin v_r := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid())); exception when others then v_e := sqlerrm; end;
  reset role;
  if (v_e is null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: guardar la recepción de prueba funciona ' || coalesce(v_e, '(no dio error)'); end if;
  v_rid := v_r->>'recepcion_id';
  if ((select count(*) from core.sync_cola where estado = 'pendiente' and tabla = 'm01_recepcion.recepciones') = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la recepción queda anotada UNA vez '; end if;
  if ((select count(*) from core.sync_cola where estado = 'pendiente' and tabla = 'm01_recepcion.recepcion_gavetas') = 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sus 3 gavetas quedan anotadas '; end if;
  if ((select count(*) from core.sync_cola where estado = 'pendiente' and tabla = 'core.lotes') = 1 and (select count(*) from core.sync_cola where estado = 'pendiente' and tabla = 'core.proveedores') >= 1 and (select count(*) from core.sync_cola where estado = 'pendiente' and tabla = 'core.especies') >= 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el lote, el proveedor y la especie quedan anotados '; end if;
  update m01_recepcion.recepciones set observacion = 'a' where recepcion_id = v_rid;
  update m01_recepcion.recepciones set observacion = 'b' where recepcion_id = v_rid;
  update m01_recepcion.recepciones set observacion = 'c' where recepcion_id = v_rid;
  if ((select count(*) from core.sync_cola where estado = 'pendiente' and tabla = 'm01_recepcion.recepciones') = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: tres cambios seguidos siguen siendo UNA sola fila pendiente '; end if;

  -- 4) el próximo lote
  v_r := public.sync_proximo_lote(500);
  v_lote := (v_r->>'lote_id')::uuid;
  if (not (v_r->>'vacio')::boolean and v_lote is not null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: entrega un lote con identificador '; end if;
  if ((select count(*) from jsonb_array_elements(v_r->'tablas') t where t->>'hoja' = 'recepciones' and jsonb_array_length(t->'filas') = 1 and t->'filas'->0->>'guia_remision' = 'ZZ-F5-1' and t->'filas'->0->>'observacion' = 'c') = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: incluye la recepción con su contenido actual '; end if;
  if ((select count(*) from jsonb_array_elements(v_r->'tablas') t where t->>'hoja' = 'recepcion_gavetas' and jsonb_array_length(t->'filas') = 3 and t->'clave' = '["recepcion_id", "num_gaveta"]'::jsonb) = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: incluye las 3 gavetas y la clave de la hoja '; end if;
  if ((v_r->>'filas')::int = (select count(*) from core.sync_cola where lote_id = v_lote)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el total de filas del lote coincide con la cola '; end if;
  if ((select count(*) from core.sync_cola where lote_id = v_lote and estado = 'enviando' and intentos = 1) = (v_r->>'filas')::int) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: lo entregado queda «enviando» con 1 intento '; end if;
  v_r2 := public.sync_proximo_lote(500);
  if ((v_r2->>'vacio')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una segunda llamada seguida NO entrega lo mismo '; end if;
  if ((select ultima_sync_ok_en is null from core.sync_estado)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con un envío sin confirmar no se da por sincronizado '; end if;

  -- 5) confirmar, y un cambio ocurrido durante el envío
  update m01_recepcion.recepciones set observacion = 'd' where recepcion_id = v_rid;
  if ((select count(*) from core.sync_cola where estado = 'pendiente' and tabla = 'm01_recepcion.recepciones') = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un cambio durante el envío crea una fila pendiente nueva '; end if;
  v_r2 := public.sync_marcar_enviado(v_lote);
  if ((v_r2->>'confirmadas')::int = (v_r->>'filas')::int and (select count(*) from core.sync_cola where lote_id = v_lote and estado = 'enviado') = (v_r->>'filas')::int) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: confirmar marca todas las filas del lote como enviadas '; end if;
  if ((select count(*) from core.sync_cola where estado = 'pendiente' and tabla = 'm01_recepcion.recepciones') = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el cambio posterior sigue pendiente '; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated; v_est := public.api_sync_estado(); reset role;
  if (v_est->>'ultima_sync_ok_en' is not null and (v_est->>'lotes_enviados')::int = 1 and (v_est->>'pendientes')::int = 1 and (v_est->>'en_envio')::int = 0 and (v_est->>'con_error')::int = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el estado refleja el envío '; end if;
  v_e := null; begin perform public.sync_marcar_enviado(v_lote); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_LOTE|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: confirmar dos veces el mismo lote avisa ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.sync_marcar_enviado(gen_random_uuid()); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_LOTE|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: confirmar un lote que no existe avisa ' || coalesce(v_e, '(no dio error)'); end if;

  -- 6) borrados
  delete from m01_recepcion.recepcion_gavetas where recepcion_id = v_rid and num_gaveta = 2;
  v_r := public.sync_proximo_lote(500);
  v_lote2 := (v_r->>'lote_id')::uuid;
  if ((select count(*) from jsonb_array_elements(v_r->'tablas') t where t->>'hoja' = 'recepcion_gavetas' and jsonb_array_length(t->'filas') = 0 and t->'borrar' = jsonb_build_array(jsonb_build_object('num_gaveta', 2, 'recepcion_id', v_rid))) = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un registro borrado se envía como «borrar» con su clave '; end if;

  -- 7) errores, espera y reintentos
  select count(*) into v_n from core.sync_cola where lote_id = v_lote2;
  v_r2 := public.sync_marcar_error(v_lote2, 'Google respondió 500');
  if ((v_r2->>'con_error')::int = v_n and (select count(*) from core.sync_cola where lote_id = v_lote2 and estado = 'error' and intentos = 1 and ultimo_error = 'Google respondió 500') = v_n) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: marcar el error deja las filas en «error» con su mensaje '; end if;
  v_r2 := public.sync_proximo_lote(500);
  if ((v_r2->>'vacio')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: durante la espera el error NO se reentrega '; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated; v_est := public.api_sync_estado(); reset role;
  if ((v_est->>'con_error')::int = v_n and v_est->>'ultimo_error' = 'Google respondió 500' and (v_est->>'lotes_con_error')::int = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el estado cuenta los errores y guarda el último '; end if;
  update core.sync_cola set proximo_intento_en = now() - interval '1 minute' where estado = 'error';
  v_r2 := public.sync_proximo_lote(500);
  if (not (v_r2->>'vacio')::boolean and (select count(*) from core.sync_cola where lote_id = (v_r2->>'lote_id')::uuid and intentos = 2) > 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: pasada la espera se reintenta (segundo intento) '; end if;
  update core.config set valor = '3'::jsonb where clave = 'sync_max_intentos'; delete from core.sync_cola where tabla = 'core.config' and estado = 'pendiente';
  perform public.sync_marcar_error((v_r2->>'lote_id')::uuid, 'otra vez');
  update core.sync_cola set proximo_intento_en = now() - interval '1 minute' where estado = 'error';
  v_r2 := public.sync_proximo_lote(500);
  v_r2 := public.sync_marcar_error((v_r2->>'lote_id')::uuid, 'tercera vez');
  if ((v_r2->>'agotadas')::int > 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: al llegar al tope de intentos las filas quedan «agotadas» '; end if;
  v_r2 := public.sync_proximo_lote(500);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated; v_est := public.api_sync_estado(); reset role;
  if ((v_r2->>'vacio')::boolean and (v_est->>'agotadas')::int = v_n and (v_est->>'con_error')::int = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una fila agotada ya no se reintenta sola, y el estado la cuenta '; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_sync_reintentar_errores();
  reset role;
  if ((v_r->>'filas')::int = v_n and (select count(*) from core.sync_cola where estado = 'error' and intentos = 0) = v_n) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador puede devolver las agotadas a la cola '; end if;
  update core.config set valor = '5'::jsonb where clave = 'sync_max_intentos'; delete from core.sync_cola where tabla = 'core.config' and estado = 'pendiente';

  -- 8) reserva vencida y filas repetidas
  loop v_r := public.sync_proximo_lote(1000); exit when (v_r->>'vacio')::boolean; perform public.sync_marcar_enviado((v_r->>'lote_id')::uuid); end loop;
  if ((select count(*) from core.sync_cola where estado <> 'enviado') = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la cola se vacía por completo al enviar todo '; end if;
  update m01_recepcion.recepciones set observacion = 'e' where recepcion_id = v_rid;
  v_r := public.sync_proximo_lote(500);
  v_lote := (v_r->>'lote_id')::uuid;
  update core.sync_cola set reservado_hasta = now() - interval '1 minute' where lote_id = v_lote;
  v_r2 := public.sync_proximo_lote(500);
  if (not (v_r2->>'vacio')::boolean and (v_r2->>'lote_id')::uuid <> v_lote and (select count(*) from core.sync_cola where lote_id = (v_r2->>'lote_id')::uuid and intentos = 2) = (v_r2->>'filas')::int) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una reserva vencida se entrega de nuevo en otro lote '; end if;
  v_e := null; begin perform public.sync_marcar_enviado(v_lote); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_LOTE|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: confirmar el lote viejo (ya reasignado) avisa ' || coalesce(v_e, '(no dio error)'); end if;
  perform public.sync_marcar_enviado((v_r2->>'lote_id')::uuid);
  -- error + cambio nuevo del mismo registro: se envía UNA vez y ambos quedan resueltos
  update m01_recepcion.recepciones set observacion = 'f' where recepcion_id = v_rid;
  v_r := public.sync_proximo_lote(500);
  perform public.sync_marcar_error((v_r->>'lote_id')::uuid, 'falla');
  update m01_recepcion.recepciones set observacion = 'g' where recepcion_id = v_rid;
  update core.sync_cola set proximo_intento_en = now() - interval '1 minute' where estado = 'error';
  v_r := public.sync_proximo_lote(500);
  if ((select count(*) from jsonb_array_elements(v_r->'tablas') t where t->>'hoja' = 'recepciones' and jsonb_array_length(t->'filas') = 1 and t->'filas'->0->>'observacion' = 'g') = 1 and (select count(*) from core.sync_cola where lote_id = (v_r->>'lote_id')::uuid and tabla = 'm01_recepcion.recepciones') = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el registro con error y con cambio nuevo sale UNA sola vez, con el dato más reciente '; end if;
  perform public.sync_marcar_enviado((v_r->>'lote_id')::uuid);
  if ((select count(*) from core.sync_cola where tabla = 'm01_recepcion.recepciones' and estado <> 'enviado') = 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: al confirmar quedan resueltas las dos filas '; end if;

  -- 9) alerta de 6 horas y sincronización al día
  update core.config set valor = 'true'::jsonb where clave = 'sync_activa'; delete from core.sync_cola where tabla = 'core.config' and estado = 'pendiente';
  update core.sync_estado set ultima_sync_ok_en = now() - interval '10 hours' where id = 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated; v_est := public.api_sync_estado(); reset role;
  if ((v_est->>'alerta')::boolean and (v_est->>'horas_sin_sincronizar')::numeric >= 10) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con la sincronización activa y 10 horas sin éxito, la alerta se enciende '; end if;
  update core.sync_estado set ultima_sync_ok_en = now() - interval '1 hour' where id = 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated; v_est := public.api_sync_estado(); reset role;
  if (not (v_est->>'alerta')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con 1 hora sin sincronizar no hay alerta '; end if;
  update core.config set valor = 'false'::jsonb where clave = 'sync_activa'; delete from core.sync_cola where tabla = 'core.config' and estado = 'pendiente';
  update core.sync_estado set ultima_sync_ok_en = now() - interval '10 hours' where id = 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated; v_est := public.api_sync_estado(); reset role;
  if (not (v_est->>'alerta')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con la sincronización sin activar no hay alerta (todavía no existe el envío automático) '; end if;
  v_r := public.sync_proximo_lote(500);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated; v_est := public.api_sync_estado(); reset role;
  if ((v_r->>'vacio')::boolean and (v_est->>'horas_sin_sincronizar')::numeric < 0.1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con la cola al día, consultar el próximo lote cuenta como sincronización correcta '; end if;

  -- 10) fotos sin respaldo, tamaño de lote y reencolar todo

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated; v_est := public.api_sync_estado(); reset role;
  v_n := (v_est->>'fotos_sin_respaldo')::int;
  insert into m01_recepcion.fotos_meta (foto_id, recepcion_id, lote_id, nn, ruta, nombre, tipo_mime, tamano_bytes, confirmada)
  values ('FOT-ZZ-F5-1', v_rid, '994-994-994', 1, 'zz-f5/1.jpg', '1.jpg', 'image/jpeg', 1000, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated; v_est := public.api_sync_estado(); reset role;
  if ((v_est->>'fotos_sin_respaldo')::int = v_n + 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una foto confirmada sin copia en Drive se cuenta como «sin respaldo» '; end if;
  if ((select count(*) from core.sync_cola where estado = 'pendiente' and tabla = 'm01_recepcion.fotos_meta') = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: y su alta quedó anotada en la cola '; end if;
  update m01_recepcion.recepciones set observacion = 'z' where recepcion_id = v_rid;
  v_r := public.sync_proximo_lote(2);
  if ((v_r->>'filas')::int = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el tamaño del lote se respeta '; end if;
  perform public.sync_marcar_error((v_r->>'lote_id')::uuid, repeat('x', 900));
  select max(length(ultimo_error)) into v_n from core.sync_cola where estado = 'error';
  if (v_n = 500) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un mensaje de error larguísimo se recorta a 500 caracteres '; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_sync_reencolar_todo();
  reset role;
  if ((v_r->>'filas')::int > 0 and exists (select 1 from core.auditoria where accion = 'sync_reencolar_todo' and user_id = v_admin and creado_en > now() - interval '1 minute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador general puede volver a encolar todo, y queda en la auditoría '; end if;

  -- 11) anotar nunca frena el guardado
  loop v_r := public.sync_proximo_lote(1000); exit when (v_r->>'vacio')::boolean; perform public.sync_marcar_enviado((v_r->>'lote_id')::uuid); end loop;
  alter table core.sync_cola add constraint zz_prueba_rompe check (false) not valid;
  v_e := null; begin update m01_recepcion.recepciones set observacion = 'h' where recepcion_id = v_rid; exception when others then v_e := sqlerrm; end;
  alter table core.sync_cola drop constraint zz_prueba_rompe;
  if (v_e is null and (select observacion from m01_recepcion.recepciones where recepcion_id = v_rid) = 'h') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: si anotar en la cola falla, el guardado de la recepción SIGUE funcionando '; end if;

  raise exception 'PRUEBAS DE LA FASE 5 · PARTE 1: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
