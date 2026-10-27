-- Prodmazul · Fase 5 · Parte 7 · Prueba de la migración 18 (reportes) EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Crea recepciones de prueba con sumas conocidas (año 2001, que no tiene datos reales) y comprueba que los reportes
-- coinciden con la cuenta hecha a mano; también comprueba el permiso y mide la velocidad con unos 6.000 registros.
-- No envía nada a Google y no deja nada guardado: al final se detiene a propósito con un mensaje de error que contiene
-- el resultado (eso deshace TODOS los datos de prueba).
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA FASE 5 · PARTE 7: NN correctas, 0 con fallo.»
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
  v_a uuid; v_b uuid; v_c uuid; v_x uuid; v_y uuid;
  v_t0    timestamptz;
  v_ms    numeric;
  v_ms2   numeric;
  v_ms3   numeric;
  v_n     integer;
  v_sumdir numeric;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;
  select p.user_id into v_op from core.perfiles p join core.usuario_modulo_rol r using (user_id)
   where p.activo and not p.es_admin_general and r.modulo_id = 'M01' and r.rol_id in ('operativo', 'consulta') limit 1;

  -- 1) existen y están protegidas

  if ((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('api_m01_rep_periodos','api_m01_rep_proveedores','api_m01_rep_especie_proveedor')) = 3 and exists (select 1 from pg_indexes where indexname = 'recepciones_reportes_idx')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: existen las tres funciones de reportes y el índice '; end if;
  if (has_function_privilege('authenticated', 'public.api_m01_rep_periodos(date,date,text,boolean)', 'execute') and has_function_privilege('authenticated', 'public.api_m01_rep_proveedores(date,date,boolean)', 'execute') and has_function_privilege('authenticated', 'public.api_m01_rep_especie_proveedor(date,date,boolean)', 'execute') and not has_function_privilege('anon', 'public.api_m01_rep_periodos(date,date,text,boolean)', 'execute') and not has_function_privilege('anon', 'public.api_m01_rep_proveedores(date,date,boolean)', 'execute') and not has_function_privilege('anon', 'public.api_m01_rep_especie_proveedor(date,date,boolean)', 'execute')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los usuarios con sesión pueden llamarlas (el permiso se revisa adentro) y el público anónimo NO '; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform core.rep_estados(false); exception when others then v_e := sqlerrm; end;
  if (v_e like 'permission denied%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: las ayudas internas no son accesibles para los usuarios '; end if;
  reset role;

  -- 2) datos de prueba con sumas conocidas (año 2001)
  insert into core.proveedores (nombre, nombre_normalizado) values ('ZZ P7 Proveedor A', 'zz p7 proveedor a') returning id into v_a;
  insert into core.proveedores (nombre, nombre_normalizado) values ('ZZ P7 Proveedor B', 'zz p7 proveedor b') returning id into v_b;
  insert into core.proveedores (nombre, nombre_normalizado) values ('ZZ P7 Proveedor C', 'zz p7 proveedor c') returning id into v_c;
  insert into core.especies (nombre, nombre_normalizado) values ('ZZ P7 Especie X', 'zz p7 especie x') returning id into v_x;
  insert into core.especies (nombre, nombre_normalizado) values ('ZZ P7 Especie Y', 'zz p7 especie y') returning id into v_y;
  insert into core.lotes (lote_id, proveedor_id) values
    ('901-901-001', v_a), ('901-901-002', v_b), ('901-901-003', v_b), ('901-901-004', v_a), ('901-901-005', v_a), ('901-901-006', v_c), ('901-901-007', v_a);
  -- (id, fecha, lote, proveedor, especie, estado, libras planta, libras reportadas)
  insert into m01_recepcion.recepciones (recepcion_id, client_uuid, fecha_llegada, lote_id, proveedor_id, especie_id, guia_remision, num_gavetas_bines,
                                         estado, libras_planta, libras_reportadas, motivo_anulacion, eliminado_en) values
    ('REC-20010304-9001', gen_random_uuid(), '2001-03-04', '901-901-001', v_a, v_x, 'ZZP7-01', 1, 'cerrado',  100, 110, null, null),
    ('REC-20010305-9002', gen_random_uuid(), '2001-03-05', '901-901-001', v_a, v_x, 'ZZP7-02', 1, 'cerrado',  200, 190, null, null),
    ('REC-20010305-9003', gen_random_uuid(), '2001-03-05', '901-901-002', v_b, v_y, 'ZZP7-03', 1, 'cerrado',  300, 300, null, null),
    ('REC-20010311-9004', gen_random_uuid(), '2001-03-11', '901-901-003', v_b, v_y, 'ZZP7-04', 1, 'cerrado',  400, 410, null, null),
    ('REC-20010312-9005', gen_random_uuid(), '2001-03-12', '901-901-004', v_a, v_y, 'ZZP7-05', 1, 'cerrado',  500, 500, null, null),
    ('REC-20010402-9006', gen_random_uuid(), '2001-04-02', '901-901-005', v_a, v_x, 'ZZP7-06', 1, 'cerrado',   50,  50, null, null),
    ('REC-20010305-9007', gen_random_uuid(), '2001-03-05', '901-901-006', v_c, v_x, 'ZZP7-07', 1, 'anulado', 9999, 9999, 'Prueba de anulación', null),
    ('REC-20010306-9008', gen_random_uuid(), '2001-03-06', '901-901-006', v_c, v_x, 'ZZP7-08', 1, 'eliminado', 8888, 8888, null, now()),
    ('REC-20010307-9009', gen_random_uuid(), '2001-03-07', '901-901-007', v_a, v_x, 'ZZP7-09', 1, 'borrador',  700, null, null, null),
    ('REC-20010305-9010', gen_random_uuid(), '2001-03-05', '901-901-001', v_a, v_x, 'ZZP7-10', 1, 'cerrado',   25,  30, null, null);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_rep_periodos('2001-03-01', '2001-03-31', 'dia');
  reset role;
  if (jsonb_array_length(v_r->'filas') = 31 and (select count(*) from jsonb_array_elements(v_r->'filas') f where (f->>'recepciones')::int = 0) = 27) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: por día: devuelve los 31 días de marzo, también los que no tuvieron recepciones (en cero) '; end if;
  if ((select (f->>'libras_planta')::numeric = 525 and (f->>'recepciones')::int = 3 from jsonb_array_elements(v_r->'filas') f where f->>'inicio' = '2001-03-05')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: por día: el 5 de marzo suma 200 + 300 + 25 = 525 libras en 3 recepciones '; end if;
  if ((select (f->>'lotes')::int = 2 from jsonb_array_elements(v_r->'filas') f where f->>'inicio' = '2001-03-05')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: por día: el 5 de marzo cuenta 2 lotes (el lote 001 llegó en dos camiones y cuenta una vez) '; end if;
  if ((select array_agg((f->>'libras_planta')::numeric order by f->>'inicio') from jsonb_array_elements(v_r->'filas') f where f->>'inicio' in ('2001-03-04','2001-03-11','2001-03-12')) = array[100,400,500]::numeric[]) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: por día: 4, 11 y 12 de marzo suman 100, 400 y 500 '; end if;
  if ((select sum((f->>'libras_planta')::numeric) from jsonb_array_elements(v_r->'filas') f) = 1525 and (v_r->'totales'->>'libras_planta')::numeric = 1525) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: NO cuentan la recepción anulada (9.999) ni la eliminada (8.888) ni el borrador (700) '; end if;
  if ((v_r->'totales'->>'recepciones')::int = 6 and (v_r->'totales'->>'lotes')::int = 4) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el total de marzo: 6 recepciones, 4 lotes distintos y 1.525 libras '; end if;
  if ((v_r->'totales'->>'libras_reportadas')::numeric = 1540 and (v_r->'totales'->>'diferencia_lb')::numeric = -15 and (v_r->'totales'->>'diferencia_pct')::numeric = -0.97) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la diferencia contra lo reportado: 1.525 - 1.540 = -15 libras (-0,97 %) '; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_rep_periodos('2001-03-01', '2001-03-31', 'semana');
  reset role;
  if ((select array_agg(f->>'inicio' order by f->>'inicio') from jsonb_array_elements(v_r->'filas') f) = array['2001-02-26','2001-03-05','2001-03-12','2001-03-19','2001-03-26']) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: por semana: la semana empieza el LUNES (26/02, 05/03, 12/03, 19/03 y 26/03) '; end if;
  if ((select (f->>'libras_planta')::numeric = 100 and f->>'fin' = '2001-03-04' from jsonb_array_elements(v_r->'filas') f where f->>'inicio' = '2001-02-26')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: por semana: el domingo 4 de marzo queda en la semana del 26/02 (100 libras) '; end if;
  if ((select (f->>'libras_planta')::numeric = 925 and (f->>'lotes')::int = 3 and (f->>'recepciones')::int = 4 and f->>'fin' = '2001-03-11' from jsonb_array_elements(v_r->'filas') f where f->>'inicio' = '2001-03-05')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: por semana: del lunes 5 al domingo 11 de marzo suma 200 + 300 + 25 + 400 = 925 libras y 3 lotes '; end if;
  if ((select (f->>'libras_planta')::numeric = 500 from jsonb_array_elements(v_r->'filas') f where f->>'inicio' = '2001-03-12') and (select count(*) from jsonb_array_elements(v_r->'filas') f where (f->>'libras_planta')::numeric = 0) = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: por semana: la semana del 12/03 suma 500 y el resto de las semanas, cero '; end if;
  if ((select array_agg((f->>'parcial')::boolean order by f->>'inicio') from jsonb_array_elements(v_r->'filas') f) = array[true,false,false,false,true]) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: por semana: marca como «parcial» la primera y la última semana (el rango las recorta) '; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_rep_periodos('2001-03-01', '2001-04-30', 'mes');
  reset role;
  if ((select (f->>'libras_planta')::numeric = 1525 and (f->>'lotes')::int = 4 and (f->>'recepciones')::int = 6 and f->>'fin' = '2001-03-31' from jsonb_array_elements(v_r->'filas') f where f->>'inicio' = '2001-03-01')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: por mes: marzo suma 1.525 libras, 6 recepciones y 4 lotes (el lote 001 cuenta UNA vez en el mes) '; end if;
  if ((select (f->>'libras_planta')::numeric = 50 and (f->>'lotes')::int = 1 and f->>'fin' = '2001-04-30' from jsonb_array_elements(v_r->'filas') f where f->>'inicio' = '2001-04-01')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: por mes: abril suma 50 libras y 1 lote '; end if;
  if ((v_r->'totales'->>'lotes')::int = 5 and (v_r->'totales'->>'libras_planta')::numeric = 1575) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: por mes: el total del rango son 5 lotes distintos y 1.575 libras '; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_rep_periodos('2001-03-01', '2001-03-31', 'mes', true);
  reset role;
  if ((v_r->'totales'->>'libras_planta')::numeric = 2225 and (v_r->'totales'->>'recepciones')::int = 7 and (v_r->'totales'->>'lotes')::int = 5 and (v_r->>'borradores')::boolean) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: con borradores incluidos (opción): marzo suma 2.225 libras, 7 recepciones y 5 lotes '; end if;
  if ((v_r->'totales'->>'diferencia_lb')::numeric = -15 and (v_r->'totales'->>'diferencia_pct')::numeric = -0.97) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el borrador sin libras reportadas no altera la diferencia '; end if;

  -- 3) proveedores y libras por proveedor
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_rep_proveedores('2001-01-01', '2001-12-31');
  reset role;
  if ((v_r->>'proveedores_con_recepcion')::int = 2 and (v_r->>'proveedores_catalogo')::int >= 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: total de proveedores con recepciones: 2 (el proveedor C solo tiene una anulada y una eliminada) '; end if;
  if ((select (f->>'libras_planta')::numeric = 875 and (f->>'recepciones')::int = 5 and (f->>'lotes')::int = 3 from jsonb_array_elements(v_r->'filas') f where f->>'proveedor' = 'ZZ P7 Proveedor A')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: proveedor A: 875 libras (100 + 200 + 500 + 50 + 25), 5 recepciones y 3 lotes '; end if;
  if ((select (f->>'libras_planta')::numeric = 700 and (f->>'recepciones')::int = 2 and (f->>'lotes')::int = 2 from jsonb_array_elements(v_r->'filas') f where f->>'proveedor' = 'ZZ P7 Proveedor B')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: proveedor B: 700 libras (300 + 400), 2 recepciones y 2 lotes '; end if;
  if (not exists (select 1 from jsonb_array_elements(v_r->'filas') f where f->>'proveedor' = 'ZZ P7 Proveedor C')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el proveedor C no aparece '; end if;
  if (v_r->'filas'->0->>'proveedor' = 'ZZ P7 Proveedor A' and (v_r->'filas'->0->>'porcentaje')::numeric = 55.56 and (v_r->'filas'->1->>'porcentaje')::numeric = 44.44) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: van ordenados de mayor a menor libras y los porcentajes suman 100 (55,56 % y 44,44 %) '; end if;
  if ((v_r->'totales'->>'libras_planta')::numeric = 1575 and (select sum((f->>'libras_planta')::numeric) from jsonb_array_elements(v_r->'filas') f) = 1575) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el total general coincide con la suma de los proveedores (1.575 libras) '; end if;

  -- 4) especie por proveedor
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_r := public.api_m01_rep_especie_proveedor('2001-01-01', '2001-12-31');
  reset role;
  if (jsonb_array_length(v_r->'filas') = 3) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: hay 3 combinaciones proveedor-especie (A-X, A-Y, B-Y) '; end if;
  if ((select (f->>'libras_planta')::numeric = 375 and (f->>'recepciones')::int = 4 and (f->>'lotes')::int = 2 from jsonb_array_elements(v_r->'filas') f where f->>'proveedor' = 'ZZ P7 Proveedor A' and f->>'especie' = 'ZZ P7 Especie X')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: A con especie X: 375 libras (100 + 200 + 50 + 25), 4 recepciones y 2 lotes '; end if;
  if ((select (f->>'libras_planta')::numeric from jsonb_array_elements(v_r->'filas') f where f->>'proveedor' = 'ZZ P7 Proveedor A' and f->>'especie' = 'ZZ P7 Especie Y') = 500 and (select (f->>'libras_planta')::numeric from jsonb_array_elements(v_r->'filas') f where f->>'proveedor' = 'ZZ P7 Proveedor B' and f->>'especie' = 'ZZ P7 Especie Y') = 700) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: A con especie Y: 500 libras; B con especie Y: 700 libras '; end if;
  if ((select (f->>'libras_planta')::numeric = 1200 and (f->>'proveedores')::int = 2 from jsonb_array_elements(v_r->'por_especie') f where f->>'especie' = 'ZZ P7 Especie Y') and (select (f->>'libras_planta')::numeric = 375 and (f->>'proveedores')::int = 1 from jsonb_array_elements(v_r->'por_especie') f where f->>'especie' = 'ZZ P7 Especie X')) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: total por especie: Y 1.200 libras con 2 proveedores y X 375 libras con 1 proveedor '; end if;
  if ((v_r->'totales'->>'proveedores')::int = 2 and (v_r->'totales'->>'especies')::int = 2 and (v_r->'totales'->>'libras_planta')::numeric = 1575) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: los totales: 2 proveedores, 2 especies y 1.575 libras '; end if;

  -- 5) reglas de uso: permiso, fechas y periodo
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_rep_periodos('2001-03-01', '2001-03-31', 'dia'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_PERMISO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: una persona sin acceso al módulo NO puede ver los reportes ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.api_m01_rep_proveedores('2001-03-01', '2001-03-31'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_PERMISO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: tampoco el de proveedores ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.api_m01_rep_especie_proveedor('2001-03-01', '2001-03-31'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_PERMISO|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: ni el de especie por proveedor ' || coalesce(v_e, '(no dio error)'); end if;
  reset role;
  if v_op is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_op, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_op::text, true); set local role authenticated;
  v_e := null; begin v_r := public.api_m01_rep_proveedores('2001-01-01', '2001-12-31'); exception when others then v_e := sqlerrm; end;
  if (v_e is null and (v_r->>'proveedores_con_recepcion')::int = 2) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un usuario con el permiso «ver_reportes» (operativo o consulta) SÍ puede verlos ' || coalesce(v_e, '(no dio error)'); end if;
    reset role;
  else v_ok := v_ok + 1; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_e := null; begin perform public.api_m01_rep_periodos('2001-03-31', '2001-03-01', 'dia'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_VALIDACION|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: «desde» posterior a «hasta» se rechaza ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.api_m01_rep_periodos('2001-03-01', '2001-03-31', 'año'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_VALIDACION|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un periodo que no existe se rechaza ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.api_m01_rep_periodos('2001-01-01', '2003-12-31', 'dia'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_VALIDACION|%400%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el reporte por día no admite más de 400 días ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin perform public.api_m01_rep_periodos('1990-01-01', '2001-12-31', 'mes'); exception when others then v_e := sqlerrm; end;
  if (v_e like 'E_VALIDACION|%') then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: fechas fuera de rango se rechazan ' || coalesce(v_e, '(no dio error)'); end if;
  v_e := null; begin v_r := public.api_m01_rep_periodos(null, null, 'dia'); exception when others then v_e := sqlerrm; end;
  if (v_e is null and (v_r->>'desde')::date = date_trunc('month', (now() at time zone 'America/Guayaquil'))::date and (v_r->>'hasta')::date = (now() at time zone 'America/Guayaquil')::date) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sin fechas usa el mes actual hasta hoy ' || coalesce(v_e, '(no dio error)'); end if;
  reset role;

  -- 6) velocidad con miles de recepciones (año 2002; se deshace al terminar)
  insert into core.proveedores (nombre, nombre_normalizado) select 'ZZ P7 vol ' || g, 'zz p7 vol ' || g from generate_series(1, 60) g;
  insert into core.especies (nombre, nombre_normalizado) select 'ZZ P7 esp ' || g, 'zz p7 esp ' || g from generate_series(1, 6) g;
  insert into core.lotes (lote_id, proveedor_id)
    select '902-' || lpad((g / 1000)::text, 3, '0') || '-' || lpad((g % 1000)::text, 3, '0'),
           (select id from core.proveedores where nombre = 'ZZ P7 vol ' || (1 + g % 60))
      from generate_series(1, 1500) g;
  insert into m01_recepcion.recepciones (recepcion_id, client_uuid, fecha_llegada, lote_id, proveedor_id, especie_id, guia_remision, num_gavetas_bines,
                                         estado, libras_planta, libras_reportadas, motivo_anulacion)
    select 'REC-' || to_char(date '2002-01-01' + (g % 365), 'YYYYMMDD') || '-' || (10000 + g), gen_random_uuid(), date '2002-01-01' + (g % 365),
           '902-' || lpad(((1 + g % 1500) / 1000)::text, 3, '0') || '-' || lpad(((1 + g % 1500) % 1000)::text, 3, '0'),
           (select id from core.proveedores where nombre = 'ZZ P7 vol ' || (1 + (1 + g % 1500) % 60)),
           (select id from core.especies where nombre = 'ZZ P7 esp ' || (1 + g % 6)),
           'ZZP7V-' || g, 1,
           case when g % 25 = 0 then 'anulado' when g % 40 = 0 then 'borrador' else 'cerrado' end,
           500 + (g % 700), 500 + (g % 700) + (g % 9) - 4, case when g % 25 = 0 then 'Prueba de volumen' end
      from generate_series(1, 6000) g;
  analyze m01_recepcion.recepciones;
  select count(*), sum(libras_planta) into v_n, v_sumdir from m01_recepcion.recepciones where fecha_llegada between '2002-01-01' and '2002-12-31' and estado = 'cerrado';

  if (v_n between 5000 and 6000) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: se crearon unas 5.700 recepciones de prueba que cuentan (cerradas) '; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true); set local role authenticated;
  v_t0 := clock_timestamp(); v_r := public.api_m01_rep_periodos('2002-01-01', '2002-12-31', 'dia'); v_ms := extract(milliseconds from clock_timestamp() - v_t0);
  if (v_ms < 3000 and jsonb_array_length(v_r->'filas') = 365) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el reporte por día de todo un año (365 filas) responde en menos de 3 segundos con miles de recepciones '; end if;
  if ((v_r->'totales'->>'libras_planta')::numeric = v_sumdir and (v_r->'totales'->>'recepciones')::int = v_n) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: y su total coincide con la suma directa de la tabla '; end if;
  v_t0 := clock_timestamp(); v_r := public.api_m01_rep_proveedores('2002-01-01', '2002-12-31'); v_ms2 := extract(milliseconds from clock_timestamp() - v_t0);
  if (v_ms2 < 3000 and (v_r->>'proveedores_con_recepcion')::int = 60 and (v_r->'totales'->>'libras_planta')::numeric = v_sumdir and (select sum((f->>'libras_planta')::numeric) from jsonb_array_elements(v_r->'filas') f) = v_sumdir) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el reporte de proveedores del año (60 proveedores) responde en menos de 3 segundos y suma lo mismo '; end if;
  v_t0 := clock_timestamp(); v_r := public.api_m01_rep_especie_proveedor('2002-01-01', '2002-12-31'); v_ms3 := extract(milliseconds from clock_timestamp() - v_t0);
  if (v_ms3 < 3000 and (v_r->'totales'->>'libras_planta')::numeric = v_sumdir and (select sum((f->>'libras_planta')::numeric) from jsonb_array_elements(v_r->'filas') f) = v_sumdir) then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el de especie por proveedor del año responde en menos de 3 segundos y suma lo mismo '; end if;
  reset role;
  v_txt := v_txt || format(E'\n  Tiempos medidos: por día %s ms, proveedores %s ms, especie por proveedor %s ms.', round(v_ms), round(v_ms2), round(v_ms3));

  raise exception E'PRUEBAS DE LA FASE 5 · PARTE 7: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
