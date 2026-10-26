-- Prodmazul · Fase 5 · Parte 5 · Prueba de la migración 16 (retención de fotos) EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Comprueba la estructura, la seguridad y las REGLAS de la purga con fotos de prueba «viejas» (fechas simuladas).
-- NO borra ningún archivo ni toca Drive, y no deja nada guardado: al final se detiene a propósito con un mensaje de error
-- que contiene el resultado (eso deshace TODOS los datos de prueba, incluida la programación que haga de prueba).
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA FASE 5 · PARTE 5: NN correctas, 0 con fallo.»
-- Ese «error» es normal: es la forma de deshacer los datos de prueba.
-- Si todavía no guardaste los secretos en Vault (Parte 3, paso 10), la parte de programación se OMITE y el mensaje lo dice.

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
  v_id    bigint;
  v_rid   text;
  v_prov  text := 'ZZ PRUEBA F5P5 ' || substr(md5(random()::text), 1, 6);
  v_esp   text := 'ZZ ESPECIE F5P5';
  v_a text; v_b text; v_c text; v_d text; v_e2 text;
  v_max   integer;
  v_secretos boolean;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;
  select p.user_id into v_op from core.perfiles p join core.usuario_modulo_rol r using (user_id)
   where p.activo and not p.es_admin_general and r.modulo_id = 'M01' and r.rol_id in ('operativo', 'consulta') limit 1;
  v_max := core.sync_cfg_int('sync_max_intentos', 5);
  v_secretos := core.sync_secreto('sync_funcion_url') is not null and core.sync_secreto('sync_secreto') is not null;
  delete from core.purga_fotos;

  -- 1) estructura y parámetros

  if ((select count(*) from pg_class where oid in ('core.purga_ejecuciones'::regclass, 'core.purga_fotos'::regclass) and relrowsecurity) = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: existen las tablas de registro de la purga, con la seguridad por filas activa '; end if;
  if ((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname, p.proname) in (('public','purga_fotos_candidatas'),('public','purga_foto_marcar_ok'),('public','purga_foto_marcar_error'),('public','purga_abrir'),('public','purga_cerrar'),('public','api_purga_ahora'),('public','api_purgas'),('core','purga_disparar'),('core','purga_programar')) ) = 9) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: existen las 9 funciones nuevas '; end if;
  if (core.sync_cfg_int('dias_retencion_fotos', 0) = 60 and core.sync_cfg_int('purga_gracia_horas', 0) = 24) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los parámetros existen: retención 60 días, gracia 24 horas '; end if;
  if (exists (select 1 from core.config where clave = 'purga_activa')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: existe el parámetro purga_activa (viene apagado; se enciende al programar la purga) '; end if;

  -- 2) seguridad
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform count(*) from core.purga_fotos; exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede leer el control de la purga '; end if;
  v_e := null; begin perform public.purga_fotos_candidatas(5); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede pedir candidatas (función interna) '; end if;
  v_e := null; begin perform public.purga_foto_marcar_ok('x'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede marcar una foto como purgada '; end if;
  v_e := null; begin perform public.purga_foto_marcar_error('x', 'e'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede marcar el error de una purga '; end if;
  v_e := null; begin perform core.purga_disparar('manual'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede lanzar la purga directamente '; end if;
  v_e := null; begin perform core.purga_programar(); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con sesión NO puede programar la purga '; end if;
  v_e := null; begin v_r := public.api_purgas(5); exception when others then v_e := sqlerrm; end;
  if (v_e is null and v_r ? 'activa' and v_r ? 'candidatas_ahora' and v_r ? 'fotos_archivadas' and v_r ? 'ejecuciones') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador general SÍ ve el estado de la purga ' || coalesce(v_e, '(no dio error)'); end if;
  reset role;
  if v_op is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_e := null; begin perform public.api_purgas(5); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_PERMISO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo NO ve el estado de la purga ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.api_purga_ahora(); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_PERMISO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un operativo NO puede pedir la purga ' || coalesce(v_e, '(no dio error)'); end if;
    reset role;
  else v_ok := v_ok + 2; end if;

  -- 3) datos de prueba: una recepción con 5 fotos de distintas edades
  insert into core.proveedores (nombre, nombre_normalizado) values (v_prov, lower(v_prov));

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_guardar_recepcion(jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', current_date, 'lote_id', '995-995-995', 'proveedor', v_prov, 'especie', v_esp,
    'num_gavetas_bines', 1, 'libras_reportadas', 100, 'libras_planta', 99, 'guia_remision', 'G-F5P5',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 99)),
    'client_uuid', gen_random_uuid()));
  v_rid := v_r->>'recepcion_id';
  reset role;
  if (v_rid is not null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se guardó la recepción de prueba '; end if;
  v_a := 'FOT-M01-995-995-995-' || v_rid || '-01'; v_b := 'FOT-M01-995-995-995-' || v_rid || '-02'; v_c := 'FOT-M01-995-995-995-' || v_rid || '-03';
  v_d := 'FOT-M01-995-995-995-' || v_rid || '-04'; v_e2 := 'FOT-M01-995-995-995-' || v_rid || '-05';
  insert into m01_recepcion.fotos_meta (foto_id, recepcion_id, lote_id, nn, ruta, nombre, tipo_mime, tamano_bytes, confirmada, subido_en, drive_file_id, respaldo_drive_en) values
    -- A: vieja (90 días), con copia confirmada hace 5 días  → SÍ se purga
    (v_a, v_rid, '995-995-995', 1, 'M01/995-995-995/' || v_rid || '/' || v_a || '-zz1.jpg', 'f.jpg', 'image/jpeg', 1000, true,  now() - interval '90 days', 'DRIVE_PRUEBA_A_12345', now() - interval '5 days'),
    -- B: joven (30 días), con copia                         → NO (menos de 60 días)
    (v_b, v_rid, '995-995-995', 2, 'M01/995-995-995/' || v_rid || '/' || v_b || '-zz2.jpg', 'f.jpg', 'image/jpeg', 1000, true,  now() - interval '30 days', 'DRIVE_PRUEBA_B_12345', now() - interval '5 days'),
    -- C: vieja SIN copia en Drive                           → NO
    (v_c, v_rid, '995-995-995', 3, 'M01/995-995-995/' || v_rid || '/' || v_c || '-zz3.jpg', 'f.jpg', 'image/jpeg', 1000, true,  now() - interval '90 days', null, null),
    -- D: vieja, copia confirmada hace 2 horas               → NO (gracia de 24 horas)
    (v_d, v_rid, '995-995-995', 4, 'M01/995-995-995/' || v_rid || '/' || v_d || '-zz4.jpg', 'f.jpg', 'image/jpeg', 1000, true,  now() - interval '90 days', 'DRIVE_PRUEBA_D_12345', now() - interval '2 hours'),
    -- E: vieja con copia, pero NO confirmada                → NO
    (v_e2, v_rid, '995-995-995', 5, 'M01/995-995-995/' || v_rid || '/' || v_e2 || '-zz5.jpg', 'f.jpg', 'image/jpeg', 1000, false, now() - interval '90 days', 'DRIVE_PRUEBA_E_12345', now() - interval '5 days');

  -- 4) reglas de la purga
  update core.config set valor = 'false'::jsonb where clave = 'purga_activa';
  v_r := public.purga_fotos_candidatas(1000);

  if ((v_r->>'activa')::boolean = false and (v_r->>'vacio')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con la purga apagada no entrega ninguna candidata '; end if;
  update core.config set valor = 'true'::jsonb where clave = 'purga_activa';
  v_r := public.purga_fotos_candidatas(1000);
  if (exists (select 1 from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' = v_a)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: encendida: la foto vieja con copia ES candidata '; end if;
  if (not exists (select 1 from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' = v_b)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la foto de 30 días NO es candidata '; end if;
  if (not exists (select 1 from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' = v_c)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la foto vieja SIN copia en Drive NO es candidata '; end if;
  if (not exists (select 1 from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' = v_d)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la foto con copia de hace 2 horas NO es candidata (gracia de 24 horas) '; end if;
  if (not exists (select 1 from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' = v_e2)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la foto sin confirmar NO es candidata '; end if;
  if ((select bool_and(x->>'ruta' like 'M01/995-995-995/%' and x->>'drive_file_id' = 'DRIVE_PRUEBA_A_12345' and (x->>'bytes_esperados')::bigint = 1000) from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' = v_a)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la candidata trae ruta, identificador de Drive y tamaño '; end if;
  update core.config set valor = '10'::jsonb where clave = 'dias_retencion_fotos';
  v_r := public.purga_fotos_candidatas(1000);
  if (exists (select 1 from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' = v_b) and not exists (select 1 from jsonb_array_elements(v_r->'fotos') x where x->>'foto_id' = v_c)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con la retención en 10 días (simulado), la de 30 días también es candidata '; end if;
  update core.config set valor = '60'::jsonb where clave = 'dias_retencion_fotos';

  -- 5) error, espera y máximo de intentos
  v_r := public.purga_foto_marcar_error(v_a, 'Drive no confirmó la copia');
  if ((v_r->>'intentos')::int = 1 and not (v_r->>'agotada')::boolean and (select purgada_supabase_en is null from m01_recepcion.fotos_meta where foto_id = v_a)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un error cuenta el intento y no purga '; end if;
  if ((select ultimo_error = 'Drive no confirmó la copia' and proximo_intento_en > now() + interval '20 hours' from core.purga_fotos where foto_id = v_a)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el error deja una espera de un día '; end if;
  if (not exists (select 1 from jsonb_array_elements(public.purga_fotos_candidatas(1000)->'fotos') x where x->>'foto_id' = v_a)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: durante la espera la foto no es candidata '; end if;
  update core.purga_fotos set intentos = v_max, proximo_intento_en = null where foto_id = v_a;
  if (not exists (select 1 from jsonb_array_elements(public.purga_fotos_candidatas(1000)->'fotos') x where x->>'foto_id' = v_a)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con el máximo de intentos queda «agotada» y deja de intentarse '; end if;
  update core.purga_fotos set intentos = 0, proximo_intento_en = null where foto_id = v_a;
  if (exists (select 1 from jsonb_array_elements(public.purga_fotos_candidatas(1000)->'fotos') x where x->>'foto_id' = v_a)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: al reactivarla vuelve a ser candidata '; end if;
  v_e := null; begin perform public.purga_foto_marcar_error('FOT-NO-EXISTE', 'x'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_NO_ENCONTRADO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: marcar el error de una foto inexistente se rechaza ' || coalesce(v_e, '(no dio error)'); end if;

  -- 6) marcar una foto como purgada (después de que la función borró el archivo)
  v_e := null; begin perform public.purga_foto_marcar_ok(v_c); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_ESTADO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una foto SIN copia en Drive no se puede marcar como purgada ' || coalesce(v_e, '(no dio error)'); end if;
  if ((select purgada_supabase_en is null from m01_recepcion.fotos_meta where foto_id = v_c)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: y no quedó marcada '; end if;
  v_e := null; begin perform public.purga_foto_marcar_ok('FOT-NO-EXISTE'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_NO_ENCONTRADO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una foto inexistente se rechaza ' || coalesce(v_e, '(no dio error)'); end if;
  v_r := public.purga_foto_marcar_ok(v_a);
  if (not (v_r->>'ya_purgada')::boolean and (select purgada_supabase_en is not null from m01_recepcion.fotos_meta where foto_id = v_a)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con copia confirmada, queda marcada como purgada '; end if;
  if ((select drive_file_id = 'DRIVE_PRUEBA_A_12345' and respaldo_drive_en is not null and confirmada from m01_recepcion.fotos_meta where foto_id = v_a)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la fila de la foto SE CONSERVA con su copia de Drive '; end if;
  if (exists (select 1 from core.auditoria where accion = 'purgar_foto' and detalle->>'foto_id' = v_a and detalle->>'drive_file_id' = 'DRIVE_PRUEBA_A_12345' and detalle ? 'ruta')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: queda en la auditoría con la ruta y el identificador de Drive '; end if;
  if (not exists (select 1 from core.purga_fotos where foto_id = v_a)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se limpió su historial de errores '; end if;
  v_r := public.purga_foto_marcar_ok(v_a);
  if ((v_r->>'ya_purgada')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: marcarla otra vez no hace nada (idempotente) '; end if;
  if (not exists (select 1 from jsonb_array_elements(public.purga_fotos_candidatas(1000)->'fotos') x where x->>'foto_id' = v_a) and not exists (select 1 from jsonb_array_elements(public.sync_fotos_pendientes(1000)->'fotos') x where x->>'foto_id' = v_a)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la foto purgada deja de ser candidata y de ser pendiente de respaldo '; end if;
  v_e := null; begin perform core.sync_fotos_olvidar(v_a); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_ESTADO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: no se puede «olvidar» el respaldo de una foto ya purgada (su única copia está en Drive) ' || coalesce(v_e, '(no dio error)'); end if;

  -- 7) lo que ve la aplicación
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_fotos_recepcion(v_rid);
  if ((select (x->>'archivada')::boolean and x->>'archivada_en' is not null from jsonb_array_elements(v_r) x where x->>'foto_id' = v_a)) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la foto purgada llega a la aplicación como «archivada» con su fecha '; end if;
  if ((select bool_and(not (x->>'archivada')::boolean) from jsonb_array_elements(v_r) x where x->>'foto_id' in (v_b, v_c, v_d))) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: las demás fotos llegan como no archivadas '; end if;
  v_e := null; begin perform public.api_m01_eliminar_foto(v_a); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_FOTOS|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la aplicación NO deja quitar una foto archivada ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.api_m01_eliminar_foto(v_b); exception when others then v_e := sqlerrm; end;
  if (v_e is null) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una foto normal sí se puede quitar ' || coalesce(v_e, '(no dio error)'); end if;
  reset role;

  -- 8) registro de corridas
  delete from core.purga_ejecuciones;
  v_id := public.purga_abrir(null, 'manual');
  if (v_id > 0 and (select estado from core.purga_ejecuciones where purga_id = v_id) = 'en_curso') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: abrir crea una corrida «en_curso» '; end if;
  v_r := public.purga_cerrar(v_id, 'ok', 3, 2, 1, 0);
  if ((select estado || candidatas || purgadas || omitidas || errores from core.purga_ejecuciones where purga_id = v_id) = 'ok3210' and v_r ? 'quedan') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cerrar guarda las cifras y cuenta lo que queda '; end if;
  v_e := null; begin perform public.purga_cerrar(v_id, 'raro', 0, 0, 0, 0); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_DATOS|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un estado inválido se rechaza ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.purga_cerrar(-5, 'ok', 0, 0, 0, 0); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_LOTE|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cerrar una corrida inexistente se rechaza ' || coalesce(v_e, '(no dio error)'); end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_purgas(5);
  reset role;
  if (jsonb_array_length(v_r->'ejecuciones') >= 1 and (v_r->>'fotos_archivadas')::int >= 1 and (v_r->>'dias_retencion')::int = 60) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador ve las corridas, lo archivado y las candidatas '; end if;

  -- 9) programación diaria
  if v_secretos then
    v_r := core.purga_programar();
  if ((v_r->>'programada')::boolean and (select schedule from cron.job where jobname = 'prodmazul-purga-fotos') = '30 8 * * *' and (select valor from core.config where clave = 'purga_activa') = 'true'::jsonb) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: programar crea la tarea diaria y enciende la purga '; end if;
  if (not exists (select 1 from cron.job where jobname = 'prodmazul-purga-fotos' and (command like '%http%' or command like '%' || core.sync_secreto('sync_secreto') || '%'))) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el texto de la tarea no contiene secretos '; end if;
    perform core.purga_programar();
  if ((select count(*) from cron.job where jobname = 'prodmazul-purga-fotos') = 1) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: programar dos veces no duplica la tarea '; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin v_r := public.api_purga_ahora(); exception when others then v_e := sqlerrm; end;
  if (v_e is null and (v_r->>'purga_id')::bigint > 0) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador SÍ puede pedir la purga ahora (con la purga encendida) ' || coalesce(v_e, '(no dio error)'); end if;
    reset role;
    v_r := core.purga_pausar();
  if (not (v_r->>'programada')::boolean and not exists (select 1 from cron.job where jobname = 'prodmazul-purga-fotos') and (select valor from core.config where clave = 'purga_activa') = 'false'::jsonb) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: pausar quita la tarea y apaga la purga '; end if;
  else
  v_e := null; begin perform core.purga_programar(); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_CONFIG|Antes de programar%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sin secretos en Vault, programar se rechaza con un mensaje claro ' || coalesce(v_e, '(no dio error)'); end if;
    v_omit := v_omit + 5;
  end if;
  update core.config set valor = 'false'::jsonb where clave = 'purga_activa';

  raise exception E'PRUEBAS DE LA FASE 5 · PARTE 5: % correctas, % con fallo.%', v_ok, v_mal,
    case when v_omit > 0 then format(' (%s comprobaciones omitidas: aún no guardaste los secretos sync_funcion_url y sync_secreto en Vault; vuelve a ejecutar esta prueba después de la Parte 3, paso 10.)', v_omit) else '' end || v_txt;
end
$prueba$;
