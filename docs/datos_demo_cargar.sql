-- Prodmazul · Fase 4 · Parte 7 · Carga de DATOS DE DEMOSTRACIÓN
-- Cómo usarlo: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Qué hace: actuando como tu usuario administrador general, crea 8 recepciones ficticias completas (gavetas, temperaturas
--   por gaveta y almacenamiento) con proveedores «DEMO …», especies «DEMO …», lotes 981-981-981, 982-982-982 y 983-983-983 y guías «DEMO-…».
--   Hay recepciones cerradas, borradores y una anulada; el lote 981-981-981 tiene dos camiones.
-- Para quitarlo todo después: ejecuta docs/datos_demo_borrar.sql.
-- RESULTADO ESPERADO: «Success. No rows returned». Si algo falla, se deshace todo y no queda nada a medias.

do $demo$
declare
  v_admin uuid;
  v_hoy   date := (now() at time zone 'America/Guayaquil')::date;
  v_id    text;
  v_r     jsonb;
  n       integer;
  g       jsonb;
begin
  if exists (select 1 from m01_recepcion.recepciones where guia_remision like 'DEMO-%') then
    raise exception 'Ya hay datos de demostración cargados. Ejecuta primero docs/datos_demo_borrar.sql.';
  end if;
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then raise exception 'No hay ningún administrador general activo en core.perfiles.'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  -- 1) Lote 981 · camión 1 · cerrada, 12 gavetas, 2 bines
  g := '[]'::jsonb;
  for n in 1..12 loop g := g || jsonb_build_object('num_gaveta', n, 'peso_lb', 48 + n); end loop;
  perform public.api_m01_guardar_recepcion(jsonb_build_object(
    'client_uuid', gen_random_uuid(), 'estado', 'cerrado', 'fecha_llegada', v_hoy, 'placa_vehiculo', 'DEM-0001',
    'lote_id', '981-981-981', 'proveedor', 'DEMO Camaronera Norte', 'especie', 'DEMO Camarón', 'piscina', 'P1',
    'guia_remision', 'DEMO-001', 'num_gavetas_bines', 12, 'libras_reportadas', 700, 'libras_planta', 690,
    'hora_inicio_descarga', '08:00', 'hora_fin_descarga', '08:45', 'observacion', 'Recepción de demostración',
    'gavetas', g,
    'temperaturas', jsonb_build_array(
      jsonb_build_object('lectura_id', 1, 'num_gaveta', 1, 'temperatura_c', 2.5),
      jsonb_build_object('lectura_id', 2, 'num_gaveta', 6, 'temperatura_c', -1.0)),
    'almacenamiento', jsonb_build_array(
      jsonb_build_object('num_bin', 'D1', 'sellos_recepcion', 'DSR-001', 'sellos_almacenamiento', 'DSA-001', 'temperatura_c', 2.0, 'libras_aprox', 350),
      jsonb_build_object('num_bin', 'D2', 'sellos_recepcion', 'DSR-002', 'sellos_almacenamiento', 'DSA-002', 'temperatura_c', -1.5, 'libras_aprox', 340))));

  -- 2) Lote 981 · camión 2 · cerrada
  g := '[]'::jsonb;
  for n in 1..8 loop g := g || jsonb_build_object('num_gaveta', n, 'peso_lb', 55 + n); end loop;
  perform public.api_m01_guardar_recepcion(jsonb_build_object(
    'client_uuid', gen_random_uuid(), 'estado', 'cerrado', 'fecha_llegada', v_hoy, 'placa_vehiculo', 'DEM-0002',
    'lote_id', '981-981-981', 'especie', 'DEMO Camarón', 'piscina', 'P1',
    'guia_remision', 'DEMO-002', 'num_gavetas_bines', 8, 'libras_reportadas', 520, 'libras_planta', 515,
    'hora_inicio_descarga', '10:00', 'hora_fin_descarga', '10:30',
    'gavetas', g,
    'temperaturas', jsonb_build_array(jsonb_build_object('lectura_id', 1, 'num_gaveta', 3, 'temperatura_c', 3.0)),
    'almacenamiento', jsonb_build_array(
      jsonb_build_object('num_bin', 'D3', 'sellos_recepcion', 'DSR-003', 'sellos_almacenamiento', 'DSA-003', 'temperatura_c', 3.0, 'libras_aprox', 515))));

  -- 3) Lote 982 · cerrada con 30 gavetas
  g := '[]'::jsonb;
  for n in 1..30 loop g := g || jsonb_build_object('num_gaveta', n, 'peso_lb', 40 + (n % 7) * 3.5); end loop;
  perform public.api_m01_guardar_recepcion(jsonb_build_object(
    'client_uuid', gen_random_uuid(), 'estado', 'cerrado', 'fecha_llegada', v_hoy - 1, 'placa_vehiculo', 'DEM-0003',
    'lote_id', '982-982-982', 'proveedor', 'DEMO Pesquera Sur', 'especie', 'DEMO Langostino', 'piscina', 'P4',
    'guia_remision', 'DEMO-003', 'llegada_en', 'gavetas', 'num_gavetas_bines', 30, 'libras_reportadas', 1500, 'libras_planta', 1488,
    'hora_inicio_descarga', '07:30', 'hora_fin_descarga', '09:00',
    'gavetas', g,
    'temperaturas', jsonb_build_array(
      jsonb_build_object('lectura_id', 1, 'num_gaveta', 2, 'temperatura_c', 1.0),
      jsonb_build_object('lectura_id', 2, 'num_gaveta', 15, 'temperatura_c', 0.5),
      jsonb_build_object('lectura_id', 3, 'num_gaveta', 30, 'temperatura_c', -0.5)),
    'almacenamiento', jsonb_build_array(
      jsonb_build_object('num_bin', 'D4', 'sellos_recepcion', 'DSR-004', 'sellos_almacenamiento', 'DSA-004', 'temperatura_c', 1.0, 'libras_aprox', 500),
      jsonb_build_object('num_bin', 'D5', 'sellos_recepcion', 'DSR-005', 'sellos_almacenamiento', 'DSA-005', 'temperatura_c', 0.5, 'libras_aprox', 500),
      jsonb_build_object('num_bin', 'D6', 'sellos_recepcion', 'DSR-006', 'sellos_almacenamiento', 'DSA-006', 'temperatura_c', -0.5, 'libras_aprox', 488))));

  -- 4) Lote 983 · borrador incompleto (solo datos generales y 3 gavetas)
  perform public.api_m01_guardar_recepcion(jsonb_build_object(
    'client_uuid', gen_random_uuid(), 'estado', 'borrador', 'fecha_llegada', v_hoy, 'placa_vehiculo', 'DEM-0004',
    'lote_id', '983-983-983', 'proveedor', 'DEMO Camaronera Norte', 'especie', 'DEMO Camarón',
    'guia_remision', 'DEMO-004', 'num_gavetas_bines', 10, 'libras_reportadas', 600,
    'gavetas', jsonb_build_array(
      jsonb_build_object('num_gaveta', 1, 'peso_lb', 52), jsonb_build_object('num_gaveta', 2, 'peso_lb', 54), jsonb_build_object('num_gaveta', 3, 'peso_lb', 51))));

  -- 5) Lote 983 · borrador solo con datos generales
  perform public.api_m01_guardar_recepcion(jsonb_build_object(
    'client_uuid', gen_random_uuid(), 'estado', 'borrador', 'fecha_llegada', v_hoy,
    'lote_id', '983-983-983', 'especie', 'DEMO Camarón', 'guia_remision', 'DEMO-005', 'num_gavetas_bines', 4, 'libras_reportadas', 220));

  -- 6) Lote 982 · cerrada y luego anulada
  v_r := public.api_m01_guardar_recepcion(jsonb_build_object(
    'client_uuid', gen_random_uuid(), 'estado', 'cerrado', 'fecha_llegada', v_hoy - 1, 'placa_vehiculo', 'DEM-0005',
    'lote_id', '982-982-982', 'especie', 'DEMO Langostino', 'guia_remision', 'DEMO-006', 'num_gavetas_bines', 2,
    'libras_reportadas', 120, 'libras_planta', 118,
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 60), jsonb_build_object('num_gaveta', 2, 'peso_lb', 58))));
  perform public.api_m01_anular(v_r->>'recepcion_id', 'Guía digitada en el lote equivocado (demostración)', (v_r->>'version')::int);

  -- 7) y 8) Más cerradas con pocas gavetas, para que el listado tenga volumen
  for n in 7..8 loop
    perform public.api_m01_guardar_recepcion(jsonb_build_object(
      'client_uuid', gen_random_uuid(), 'estado', 'cerrado', 'fecha_llegada', v_hoy - (n - 6), 'placa_vehiculo', 'DEM-000' || n,
      'lote_id', '982-982-982', 'especie', 'DEMO Langostino', 'guia_remision', 'DEMO-00' || n, 'num_gavetas_bines', 3,
      'libras_reportadas', 180, 'libras_planta', 179,
      'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta', 1, 'peso_lb', 60), jsonb_build_object('num_gaveta', 2, 'peso_lb', 59), jsonb_build_object('num_gaveta', 3, 'peso_lb', 60)),
      'almacenamiento', jsonb_build_array(jsonb_build_object('num_bin', 'E' || n, 'sellos_recepcion', 'ESR-' || n, 'libras_aprox', 179))));
  end loop;
end
$demo$;
