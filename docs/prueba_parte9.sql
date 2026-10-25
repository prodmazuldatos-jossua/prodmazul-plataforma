-- Prodmazul · Fase 4 · Parte 9 · Prueba de las fotos EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Actúa como tu usuario administrador general, crea una recepción de prueba (ZZ) y comprueba las reglas de las fotos
-- (registro, subida permitida, confirmación, límite de 5, reutilización de cupos, borrado y auditoría).
-- Al final se detiene a propósito con un mensaje de error que contiene el resultado, y por eso NO queda ningún dato guardado.
-- Nota: esta prueba NO sube archivos reales; la subida y la vista real se prueban en el navegador (ver la guía).
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA PARTE 9: 15 correctas, 0 con fallo.»
-- Ese «error» es normal: es la forma de deshacer los datos de prueba.

do $prueba$
declare
  v_admin uuid;
  v_ok    integer := 0;
  v_mal   integer := 0;
  v_txt   text := '';
  v_e     text;
  v_r     jsonb;
  v_id    text;
  v_n     integer;
  v_b     boolean;
  v_f1    jsonb;
  v_hoy   date := (now() at time zone 'America/Guayaquil')::date;
  v_base  jsonb;
begin
  select user_id into v_admin from core.perfiles where es_admin_general and activo order by creado_en limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador general activo en core.perfiles.';
  end if;
  v_base := jsonb_build_object(
    'estado', 'cerrado', 'fecha_llegada', v_hoy, 'lote_id', '994-994-994', 'llegada_en', 'gavetas',
    'proveedor', 'ZZ PRUEBA PROVEEDOR', 'especie', 'ZZ PRUEBA ESPECIE', 'num_gavetas_bines', 3,
    'libras_reportadas', 300, 'libras_planta', 295, 'guia_remision', 'ZZ-P9-A',
    'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',50), jsonb_build_object('num_gaveta',2,'peso_lb',51)),
    'temperaturas', jsonb_build_array());

  -- 1) el depósito es privado y tiene los límites
  select count(*) into v_n from storage.buckets
   where id = 'm01-recepcion-fotos' and public = false and file_size_limit = 5242880
     and allowed_mime_types @> array['image/jpeg','image/png','image/webp'];
  if v_n = 1 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el depósito m01-recepcion-fotos es privado, de 5 MB y solo imágenes ' || coalesce(v_e, ''); end if;

  select count(*) into v_n from pg_policies where schemaname = 'storage' and tablename = 'objects'
   and policyname in ('m01_fotos_subir', 'm01_fotos_ver', 'm01_fotos_borrar');
  if v_n = 3 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: existen las 3 reglas de acceso a las fotos ' || coalesce(v_e, ''); end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  v_r := public.api_m01_guardar_recepcion(v_base || jsonb_build_object('client_uuid', gen_random_uuid()));
  v_id := v_r->>'recepcion_id';

  -- 2) registrar una foto
  v_f1 := public.api_m01_registrar_foto(v_id, 'ZZ-foto-1.jpg', 'image/jpeg', 200000);
  v_e := null;
  if (v_f1->>'nn')::integer = 1 and v_f1->>'ruta' like 'M01/994-994-994/' || v_id || '/%.jpg' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: registrar da el cupo 1 y una ruta ordenada '||v_f1::text||' ' || coalesce(v_e, ''); end if;

  -- 3) confirmar sin haber subido el archivo debe fallar
  v_e := null;
  begin perform public.api_m01_confirmar_foto(v_f1->>'foto_id'); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_FOTOS|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: confirmar sin archivo subido ' || coalesce(v_e, ''); end if;

  -- 4) la regla de subida deja subir solo ese archivo
  select public.m01_foto_permitida(v_f1->>'ruta', 'subir') into v_b;
  if v_b is true then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la regla permite subir el archivo registrado ' || coalesce(v_e, ''); end if;

  select public.m01_foto_permitida('M01/994-994-994/' || v_id || '/otra-ruta.jpg', 'subir') into v_b;
  if v_b is not true then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la regla NO permite subir una ruta que no se registró ' || coalesce(v_e, ''); end if;

  -- se simula la subida (en la realidad la hace el navegador) y se confirma
  reset role;
  insert into storage.objects (bucket_id, name) values ('m01-recepcion-fotos', v_f1->>'ruta');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  v_e := null;
  begin v_r := public.api_m01_confirmar_foto(v_f1->>'foto_id'); exception when others then v_e := sqlerrm; end;
  if v_e is null and (v_r->>'confirmada')::boolean then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: confirmar con el archivo subido ' || coalesce(v_e, ''); end if;

  v_r := public.api_m01_fotos_recepcion(v_id);
  if jsonb_array_length(v_r) = 1 and v_r->0->>'nombre' = 'ZZ-foto-1.jpg' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la lista trae la foto confirmada ' || coalesce(v_e, ''); end if;

  select public.m01_foto_permitida(v_f1->>'ruta', 'ver') into v_b;
  if v_b is true then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la regla permite ver la foto confirmada ' || coalesce(v_e, ''); end if;

  select public.m01_foto_permitida(v_f1->>'ruta', 'borrar') into v_b;
  if v_b is true then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la regla permite borrar la foto de una recepción activa ' || coalesce(v_e, ''); end if;

  -- 5) tipo no permitido y máximo de 5
  v_e := null;
  begin perform public.api_m01_registrar_foto(v_id, 'ZZ.gif', 'image/gif', 1000); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_VALIDACION|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: un GIF no se acepta ' || coalesce(v_e, ''); end if;

  for v_n in 2..5 loop
    perform public.api_m01_registrar_foto(v_id, 'ZZ-' || v_n || '.jpg', 'image/jpeg', 1000);
  end loop;
  v_e := null;
  begin perform public.api_m01_registrar_foto(v_id, 'ZZ-6.jpg', 'image/jpeg', 1000); exception when others then v_e := sqlerrm; end;
  if v_e like 'E_FOTOS|%' then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: la sexta foto se rechaza ' || coalesce(v_e, ''); end if;

  -- 6) borrar libera el cupo 1
  -- (el archivo simulado no se borra aquí: Supabase no permite borrar de storage.objects con SQL; todo se deshace al final)
  v_r := public.api_m01_eliminar_foto(v_f1->>'foto_id');
  v_e := null;
  if (v_r->>'eliminada')::boolean then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: eliminar la foto ' || coalesce(v_e, ''); end if;

  v_r := public.api_m01_registrar_foto(v_id, 'ZZ-nueva.jpg', 'image/jpeg', 1000);
  if (v_r->>'nn')::integer = 1 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: el cupo liberado se reutiliza ' || coalesce(v_e, ''); end if;

  -- 7) auditoría
  reset role;
  select count(*) into v_n from core.auditoria where entidad_id = v_id and accion in ('subir_foto', 'eliminar_foto');
  v_e := null;
  if v_n = 2 then v_ok := v_ok + 1; else v_mal := v_mal + 1; v_txt := v_txt || E'\n  FALLÓ: quedan registros de auditoría de subir y eliminar (hay ' || v_n || ') ' || coalesce(v_e, ''); end if;

  raise exception 'PRUEBAS DE LA PARTE 9: % correctas, % con fallo.%', v_ok, v_mal, v_txt;
end
$prueba$;
