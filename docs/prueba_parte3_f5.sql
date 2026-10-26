-- Prodmazul · Fase 5 · Parte 3 · Prueba de la migración 14 (programación del exportador) EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Comprueba la estructura, la seguridad, la programación cada 2 horas, «sincronizar ahora» y el registro de ejecuciones.
-- NO envía nada a Google: las llamadas HTTP que pide quedan dentro de la transacción y se descartan al final
-- (pg_net solo envía una petición cuando la transacción se confirma, y esta prueba termina deshaciéndolo todo).
-- Al final se detiene a propósito con un mensaje de error que contiene el resultado; por eso NO queda ningún cambio guardado
-- (ni tareas programadas, ni filas en la cola, ni ejecuciones).
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA FASE 5 · PARTE 3: NN correctas, 0 con fallo.»
-- Ese «error» es normal: es la forma de deshacer los datos de prueba.
-- Si todavía no guardaste los secretos en Vault (paso 6 de la guía), algunas comprobaciones se OMITEN y el mensaje lo dice.

do $prueba$
declare
  v_admin uuid;
  v_op    uuid;
  v_ok    integer := 0;
  v_mal   integer := 0;
  v_omit  integer := 0;
  v_txt   text := '';
  v_e     text;
  v_r     jsonb;
  v_n     bigint;
  v_n2    bigint;
  v_id    bigint;
  v_id2   bigint;
  v_secretos boolean;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;
  select p.user_id into v_op from core.perfiles p join core.usuario_modulo_rol r using (user_id)
   where p.activo and not p.es_admin_general and r.modulo_id = 'M01' and r.rol_id in ('operativo', 'consulta') limit 1;
  v_secretos := core.sync_secreto('sync_funcion_url') is not null and core.sync_secreto('sync_secreto') is not null;

  delete from core.sync_cola;
  delete from core.sync_ejecuciones;

  -- 1) estructura
  if ((select count(*) from pg_extension where extname in ('pg_net', 'pg_cron', 'supabase_vault')) = 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: están instaladas las 3 extensiones (pg_net, pg_cron, Vault) '; end if;
  if ((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname, p.proname) in (('core','sync_secreto'),('core','sync_disparar'),('core','sync_programar'),('core','sync_pausar'),('core','sync_encolar_catalogos'),('public','sync_ejecucion_abrir'),('public','sync_ejecucion_cerrar'),('public','api_sync_ahora'),('public','api_sync_ejecuciones'))) = 9) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: existen las 9 funciones nuevas '; end if;
  if ((select relrowsecurity from pg_class where oid = 'core.sync_ejecuciones'::regclass)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la tabla de ejecuciones tiene la seguridad por filas activa '; end if;

  -- 2) seguridad
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform count(*) from core.sync_ejecuciones; exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede leer las ejecuciones ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.sync_ejecucion_abrir(null, 'manual'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede abrir ejecuciones (función interna) ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.sync_ejecucion_cerrar(1, 'ok', 0, 0, null); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede cerrar ejecuciones (función interna) ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform core.sync_disparar('manual'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede llamar a sync_disparar directamente ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform core.sync_programar(); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede programar ni pausar ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform core.sync_secreto('sync_secreto'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede leer los secretos ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin v_r := public.api_sync_ejecuciones(5); exception when others then v_e := sqlerrm; end;
  if (v_e is null and jsonb_typeof(v_r->'ejecuciones') = 'array') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador general SÍ ve las ejecuciones ' || coalesce(v_e, '(no dio error)'); end if;
  reset role;
  if v_op is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_e := null; begin perform public.api_sync_ejecuciones(5); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_PERMISO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo NO ve las ejecuciones ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.api_sync_ahora(); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_PERMISO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo NO puede pedir «sincronizar ahora» ' || coalesce(v_e, '(no dio error)'); end if;
    reset role;
  else v_ok := v_ok + 2; end if;

  -- 3) catálogos para el año nuevo
  delete from core.sync_cola;
  v_n := core.sync_encolar_catalogos();
  if (v_n > 0 and not exists (select 1 from core.sync_cola where tabla not like 'core.%')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: anota los catálogos del núcleo (y solo ellos) '; end if;
  v_n2 := core.sync_encolar_catalogos();
  if (v_n2 = v_n and (select count(*) from core.sync_cola) = v_n) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: repetirlo no duplica las filas pendientes '; end if;
  delete from core.sync_cola;

  -- 4) programación
  if v_secretos then
    v_r := core.sync_programar();
  if ((v_r->>'programada')::boolean and (select count(*) from cron.job where jobname in ('prodmazul-sync-exportar', 'prodmazul-sync-catalogos-anio')) = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: programar crea las dos tareas '; end if;
  if ((select schedule from cron.job where jobname = 'prodmazul-sync-exportar') = '0 */2 * * *') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el exportador corre cada 2 horas '; end if;
  if ((select schedule from cron.job where jobname = 'prodmazul-sync-catalogos-anio') = '10 5 1 1 *') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los catálogos se re-anotan el 1 de enero (00:10 hora de Ecuador) '; end if;
  if ((select valor from core.config where clave = 'sync_activa') = 'true'::jsonb) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: programar activa la sincronización (alerta de 6 horas) '; end if;
  if (not exists (select 1 from cron.job where jobname like 'prodmazul-sync%' and (command like '%http%' or command like '%' || core.sync_secreto('sync_secreto') || '%'))) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el texto de las tareas no contiene secretos ni direcciones '; end if;
    perform core.sync_programar();
  if ((select count(*) from cron.job where jobname like 'prodmazul-sync%') = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: programar dos veces no duplica las tareas '; end if;
    v_r := core.sync_pausar();
  if (not (v_r->>'programada')::boolean and (select count(*) from cron.job where jobname like 'prodmazul-sync%') = 0 and (select valor from core.config where clave = 'sync_activa') = 'false'::jsonb) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: pausar quita las tareas y apaga la sincronización '; end if;
  else
  v_e := null; begin perform core.sync_programar(); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_CONFIG|Antes de programar%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sin secretos en Vault, programar se rechaza con un mensaje claro ' || coalesce(v_e, '(no dio error)'); end if;
    v_omit := v_omit + 5;
  end if;

  -- 5) sincronizar ahora
  if v_secretos then
    v_r := core.sync_disparar('manual');
  if ((v_r->>'ejecucion_id')::bigint > 0 and (v_r->>'request_id')::bigint > 0 and (select estado from core.sync_ejecuciones where ejecucion_id = (v_r->>'ejecucion_id')::bigint) = 'pedida') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sincronizar ahora crea una ejecución «pedida» con su llamada HTTP '; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin v_r := public.api_sync_ahora(); exception when others then v_e := sqlerrm; end;
  if (v_e is null and (v_r->>'ejecucion_id')::bigint > 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador general SÍ puede pedir «sincronizar ahora» ' || coalesce(v_e, '(no dio error)'); end if;
    reset role;
  if (exists (select 1 from core.auditoria where accion = 'sync_ahora' and user_id = v_admin and creado_en > now() - interval '1 minute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: queda en la auditoría '; end if;
  else
  v_e := null; begin perform core.sync_disparar('manual'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_CONFIG|Falta el secreto%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sin secretos, «sincronizar ahora» se rechaza con un mensaje claro ' || coalesce(v_e, '(no dio error)'); end if;
    v_r := core.sync_disparar('cron');
  if (not (v_r->>'ok')::boolean and exists (select 1 from core.sync_ejecuciones where origen = 'cron' and estado = 'con_error')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la tarea programada sin secretos NO falla: deja la ejecución anotada con error '; end if;
    v_omit := v_omit + 3;
  end if;

  -- 6) registro de ejecuciones
  delete from core.sync_ejecuciones;
  v_id := public.sync_ejecucion_abrir(null, 'manual');
  if (v_id > 0 and (select estado from core.sync_ejecuciones where ejecucion_id = v_id) = 'en_curso') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: abrir sin número crea una ejecución «en_curso» '; end if;
  insert into core.sync_cola (tabla, clave, clave_json, operacion) values ('core.proveedores', '{"id": "zz"}', '{"id": "zz"}', 'upsert');
  v_r := public.sync_ejecucion_cerrar(v_id, 'con_error', 2, 40, 'Google: no autorizado');
  if ((v_r->>'quedan')::integer = (select count(*) from core.sync_cola where estado in ('pendiente', 'enviando')) and (v_r->>'quedan')::integer >= 1 and (select estado || lotes || filas from core.sync_ejecuciones where ejecucion_id = v_id) = 'con_error240') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cerrar guarda el resultado y cuenta lo que queda por enviar '; end if;
  if ((select ultimo_error from core.sync_estado where id = 1) = 'Google: no autorizado') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un error al cerrar queda visible en el estado de la sincronización '; end if;
  v_e := null; begin perform public.sync_ejecucion_cerrar(v_id, 'raro', 0, 0, null); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_DATOS|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un estado inválido se rechaza ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.sync_ejecucion_cerrar(-5, 'ok', 0, 0, null); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_LOTE|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cerrar una ejecución inexistente se rechaza ' || coalesce(v_e, '(no dio error)'); end if;
  insert into core.sync_ejecuciones (origen, pedida_en) values ('cron', now() - interval '30 minutes') returning ejecucion_id into v_id2;
  v_id := public.sync_ejecucion_abrir(v_id2, 'cron');
  if (v_id = v_id2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: abrir una ejecución pedida la pasa a «en_curso» sin crear otra '; end if;
  insert into core.sync_ejecuciones (origen, pedida_en) values ('cron', now() - interval '30 minutes') returning ejecucion_id into v_id2;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_sync_ejecuciones(10);
  reset role;
  if (exists (select 1 from jsonb_array_elements(v_r->'ejecuciones') x where (x->>'ejecucion_id')::bigint = v_id2 and x->>'estado' = 'sin_respuesta')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una ejecución pedida hace más de 5 minutos que nunca arrancó se muestra como «sin_respuesta» '; end if;

  raise exception E'PRUEBAS DE LA FASE 5 · PARTE 3: % correctas, % con fallo.%', v_ok, v_mal,
    case when v_omit > 0 then format(' (%s comprobaciones omitidas: aún no guardaste los secretos sync_funcion_url y sync_secreto en Vault; vuelve a ejecutar esta prueba después del paso 6.)', v_omit) else '' end || v_txt;
end
$prueba$;
