-- Prodmazul · Fase 4 · Parte 7 · Prueba de la migración 8 (cierre de lote y temperaturas por gaveta) EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Actúa como tu usuario administrador general, crea datos de prueba (ZZ) y comprueba las reglas nuevas.
-- Al final se detiene a propósito con un mensaje de error que contiene el resultado, y por eso NO queda ningún dato guardado.
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA PARTE 7: 16 correctas, 0 con fallo.»
-- Ese «error» es normal: es la forma de deshacer los datos de prueba.

do $prueba$
declare
  v_admin uuid;
  v_ok    integer := 0;
  v_mal   integer := 0;
  v_txt   text := '';
  v_e     text;
  v_r     jsonb;
  v_n     integer;
  v_hoy   date := (now() at time zone 'America/Guayaquil')::date;
  v_base  jsonb;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;
  v_base := jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '995-995-995',
    'proveedor', 'ZZ PRUEBA PROVEEDOR', 'especie', 'ZZ PRUEBA ESPECIE', 'num_gavetas_bines', 3,
    'libras_reportadas', 300, 'libras_planta', 295,
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',50), jsonb_build_object('num_gaveta',2,'peso_lb',51), jsonb_build_object('num_gaveta',30,'peso_lb',52)));

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  -- 1) temperaturas por gaveta
  v_e := null; v_r := null;
  begin v_r := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P7-A',
      'temperaturas', jsonb_build_array(jsonb_build_object('lectura_id',1,'num_gaveta',1,'temperatura_c',-2.5), jsonb_build_object('lectura_id',2,'num_gaveta',30,'temperatura_c',1.3))));
  exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'lote_cerrado')::boolean = false then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: guardar con temperaturas por gaveta (el lote debe seguir abierto) ' || coalesce(v_e, v_r::text); end if;

  v_e := null;
  begin perform public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P7-B',
      'temperaturas', jsonb_build_array(jsonb_build_object('lectura_id',1,'num_gaveta',9,'temperatura_c',2))));
  exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: temperatura de una gaveta sin peso ' || coalesce(v_e, '(no dio error)'); end if;

  v_e := null;
  begin perform public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P7-C',
      'temperaturas', jsonb_build_array(jsonb_build_object('lectura_id',1,'num_gaveta',1,'temperatura_c',2), jsonb_build_object('lectura_id',2,'num_gaveta',1,'temperatura_c',3))));
  exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: dos temperaturas en la misma gaveta ' || coalesce(v_e, '(no dio error)'); end if;

  reset role;
  select count(*) into v_n from m01_recepcion.recepcion_temperaturas t join m01_recepcion.recepciones r using (recepcion_id) where r.guia_remision = 'ZZ-P7-A' and t.num_gaveta in (1, 30);
  if v_n = 2 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: las 2 temperaturas quedaron con su gaveta (hay ' || v_n || ')'; end if;
  set local role authenticated;

  -- 2) un proveedor con varios lotes
  v_e := null;
  begin
    perform public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P7-D', 'lote_id', '994-994-994'));
    perform public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P7-E', 'lote_id', '993-993-993'));
  exception when others then v_e := sqlerrm; end;
  reset role;
  select count(*) into v_n from core.lotes l join core.proveedores p on p.id = l.proveedor_id where p.nombre_normalizado = 'ZZ PRUEBA PROVEEDOR';
  if v_e is null and v_n = 3 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un proveedor con 3 lotes (hay ' || v_n || ') ' || coalesce(v_e, ''); end if;
  set local role authenticated;

  -- 3) cierre de lote
  v_e := null; v_r := null;
  begin v_r := public.api_obtener_lote('995-995-995'); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'cerrado')::boolean = false and (v_r->>'camiones')::int = 1 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el lote sigue abierto con 1 camión ' || coalesce(v_e, v_r::text); end if;

  v_e := null; v_r := null;
  begin v_r := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P7-F', 'estado', 'borrador', 'cerrar_lote', true));
  exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'lote_cerrado')::boolean = false then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un borrador no cierra el lote ' || coalesce(v_e, v_r::text); end if;

  v_e := null; v_r := null;
  begin v_r := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P7-G', 'cerrar_lote', true));
  exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'lote_cerrado')::boolean = true then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el último camión cierra el lote ' || coalesce(v_e, v_r::text); end if;

  v_e := null; v_r := null;
  begin v_r := public.api_obtener_lote('995-995-995'); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'cerrado')::boolean = true and (v_r->>'camiones')::int = 3 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: api_obtener_lote informa lote cerrado con 3 camiones ' || coalesce(v_e, v_r::text); end if;

  v_e := null;
  begin perform public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P7-H'));
  exception when others then v_e := sqlerrm; end;
  if v_e like 'E_ESTADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un lote cerrado no admite recepciones nuevas ' || coalesce(v_e, '(no dio error)'); end if;

  v_e := null; v_r := null;
  begin v_r := public.api_m01_reabrir_lote('995-995-995'); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'cerrado')::boolean = false then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el administrador reabre el lote ' || coalesce(v_e, v_r::text); end if;

  v_e := null;
  begin perform public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P7-I'));
  exception when others then v_e := sqlerrm; end;
  if v_e is null then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: lote reabierto admite otro camión ' || v_e; end if;

  v_e := null; v_r := null;
  begin v_r := public.api_m01_cerrar_lote('995-995-995'); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'cerrado')::boolean = true then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cerrar el lote sin grabar una recepción ' || coalesce(v_e, v_r::text); end if;

  v_e := null;
  begin perform public.api_m01_cerrar_lote('995-995-995'); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_ESTADO|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: cerrar un lote ya cerrado avisa ' || coalesce(v_e, '(no dio error)'); end if;

  -- 4) bines o gavetas
  v_e := null; v_r := null;
  begin v_r := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P7-J', 'lote_id', '992-992-992', 'estado', 'borrador'));
  exception when others then v_e := sqlerrm; end;
  if v_e is null then
    v_r := public.api_m01_obtener_recepcion(v_r->>'recepcion_id');
  end if;
  if v_e is null and v_r->>'llegada_en' = 'bines' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: sin indicarlo, el producto llega en bines ' || coalesce(v_e, ''); end if;

  v_e := null;
  begin perform public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid(), 'guia_remision', 'ZZ-P7-K', 'lote_id', '992-992-992', 'llegada_en', 'cajas'));
  exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un tipo de llegada distinto de bines o gavetas se rechaza ' || coalesce(v_e, '(no dio error)'); end if;

  raise exception 'PRUEBAS DE LA PARTE 7: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
