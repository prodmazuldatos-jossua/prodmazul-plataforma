-- Prodmazul · Fase 4 · Parte 2 · Prueba de las tablas de Recepción EN TU PROYECTO DE SUPABASE
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
--
-- Qué hace: crea datos de prueba, intenta guardar datos válidos e inválidos y comprueba que la base
-- de datos acepte lo correcto y rechace lo incorrecto. Al final se detiene a propósito con un mensaje
-- de error que contiene el resultado, y por eso NO queda ningún dato de prueba guardado.
--
-- RESULTADO ESPERADO: un mensaje rojo que empieza con
--   «PRUEBAS DE LA PARTE 2: 44 correctas, 0 con fallo.»
-- Ese «error» es normal: es la forma de deshacer los datos de prueba. Si aparece «con fallo» mayor a 0,
-- el mensaje lista cuáles fallaron.

do $prueba$
declare
  v_prov uuid;
  v_esp  uuid;
  v_rec  text;
  v_ok   integer := 0;
  v_mal  integer := 0;
  v_txt  text := '';
  t      record;
  v_sql  text;
  v_err  text;
begin
  -- datos de apoyo (se deshacen al final)
  v_prov := core.obtener_o_crear_proveedor('ZZ PRUEBA PROVEEDOR');
  v_esp  := core.obtener_o_crear_especie('ZZ PRUEBA ESPECIE');
  insert into core.lotes (lote_id, proveedor_id, especie_id) values ('999-999-999', v_prov, v_esp);
  v_rec := m01_recepcion.siguiente_id(date '2099-01-01');
  insert into m01_recepcion.recepciones
    (recepcion_id, client_uuid, fecha_llegada, lote_id, proveedor_id, especie_id, guia_remision,
     num_gavetas_bines, libras_reportadas, libras_planta, hora_inicio_descarga, hora_fin_descarga)
  values (v_rec, gen_random_uuid(), date '2099-01-01', '999-999-999', v_prov, v_esp, 'ZZ-PRUEBA-1',
          3, 1000, 990, time '08:00', time '09:30');

  for t in
    select * from (values
      -- (nombre, instrucción, esperado: 'ok' si debe aceptarse, o parte del mensaje de error si debe rechazarse)
      ('el identificador es REC-AAAAMMDD-0001', $q$select 1/(case when '{rec}' = 'REC-20990101-0001' then 1 else 0 end)$q$, 'ok'),
      ('los valores calculados son correctos (-10 lb, -1 %, 90 min)', $q$select 1/(case when (select diferencia_lb = -10 and diferencia_pct = -1 and duracion_descarga_min = 90 from m01_recepcion.recepciones where recepcion_id = '{rec}') then 1 else 0 end)$q$, 'ok'),
      ('identificador con formato inválido', $q$insert into m01_recepcion.recepciones(recepcion_id,client_uuid,fecha_llegada,lote_id,proveedor_id,especie_id,guia_remision,num_gavetas_bines) values ('REC-T-1',gen_random_uuid(),'2099-01-01','999-999-999','{prov}','{esp}','ZZ-2',1)$q$, 'id_chk'),
      ('guía de remisión repetida', $q$insert into m01_recepcion.recepciones(recepcion_id,client_uuid,fecha_llegada,lote_id,proveedor_id,especie_id,guia_remision,num_gavetas_bines) values ('REC-20990101-0002',gen_random_uuid(),'2099-01-01','999-999-999','{prov}','{esp}','ZZ-PRUEBA-1',1)$q$, 'guia_key'),
      ('lote inexistente', $q$update m01_recepcion.recepciones set lote_id = '111-111-111' where recepcion_id = '{rec}'$q$, 'foreign key'),
      ('estado inválido', $q$update m01_recepcion.recepciones set estado = 'otro' where recepcion_id = '{rec}'$q$, 'estado_chk'),
      ('0 gavetas', $q$update m01_recepcion.recepciones set num_gavetas_bines = 0 where recepcion_id = '{rec}'$q$, 'gavetas_chk'),
      ('libras planta negativas', $q$update m01_recepcion.recepciones set libras_planta = -1 where recepcion_id = '{rec}'$q$, 'lbs_pla_chk'),
      ('hora final anterior a la inicial', $q$update m01_recepcion.recepciones set hora_fin_descarga = '07:00' where recepcion_id = '{rec}'$q$, 'horas_chk'),
      ('observación de más de 2000 caracteres', $q$update m01_recepcion.recepciones set observacion = repeat('x', 2001) where recepcion_id = '{rec}'$q$, 'obs_chk'),
      ('anular sin motivo', $q$update m01_recepcion.recepciones set estado = 'anulado' where recepcion_id = '{rec}'$q$, 'motivo_chk'),
      ('anular con motivo válido', $q$update m01_recepcion.recepciones set estado = 'anulado', motivo_anulacion = 'Error de digitación' where recepcion_id = '{rec}'$q$, 'ok'),
      ('volver a borrador', $q$update m01_recepcion.recepciones set estado = 'borrador', motivo_anulacion = null where recepcion_id = '{rec}'$q$, 'ok'),
      ('cambiar el identificador', $q$update m01_recepcion.recepciones set recepcion_id = 'REC-20990101-9999' where recepcion_id = '{rec}'$q$, 'no se pueden cambiar'),
      ('cambiar la fecha de creación', $q$update m01_recepcion.recepciones set creado_en = now() - interval '1 day' where recepcion_id = '{rec}'$q$, 'no se pueden cambiar'),
      ('editar la piscina (permitido)', $q$update m01_recepcion.recepciones set piscina = 'P7' where recepcion_id = '{rec}'$q$, 'ok'),
      ('borrar una recepción', $q$delete from m01_recepcion.recepciones where recepcion_id = '{rec}'$q$, 'no se borran'),
      ('gaveta 1 con 40 lb', $q$insert into m01_recepcion.recepcion_gavetas values ('{rec}', 1, 40)$q$, 'ok'),
      ('gaveta 30', $q$insert into m01_recepcion.recepcion_gavetas values ('{rec}', 30, 40)$q$, 'ok'),
      ('gaveta 31', $q$insert into m01_recepcion.recepcion_gavetas values ('{rec}', 31, 40)$q$, 'check'),
      ('gaveta repetida', $q$insert into m01_recepcion.recepcion_gavetas values ('{rec}', 1, 41)$q$, 'duplicate key'),
      ('peso de gaveta en cero', $q$insert into m01_recepcion.recepcion_gavetas values ('{rec}', 2, 0)$q$, 'check'),
      ('temperatura negativa', $q$insert into m01_recepcion.recepcion_temperaturas values ('{rec}', 1, '1,2', -1.5)$q$, 'ok'),
      ('lectura de temperatura 7', $q$insert into m01_recepcion.recepcion_temperaturas values ('{rec}', 7, '1', -1)$q$, 'check'),
      ('almacenamiento válido', $q$insert into m01_recepcion.recepcion_almacenamiento values ('{rec}', '1', 'A1', 'B1', -1, 500)$q$, 'ok'),
      ('bin repetido', $q$insert into m01_recepcion.recepcion_almacenamiento values ('{rec}', '1', 'A9', 'B9', -1, 500)$q$, 'duplicate key'),
      ('sello de recepción repetido', $q$insert into m01_recepcion.recepcion_almacenamiento values ('{rec}', '2', 'A1', 'B2', -1, 500)$q$, 'sello_rec'),
      ('sello de almacenamiento repetido', $q$insert into m01_recepcion.recepcion_almacenamiento values ('{rec}', '2', 'A2', 'B1', -1, 500)$q$, 'sello_alm'),
      ('bines sin sellos', $q$insert into m01_recepcion.recepcion_almacenamiento(recepcion_id, num_bin) values ('{rec}', '3'), ('{rec}', '4')$q$, 'ok'),
      ('bin vacío', $q$insert into m01_recepcion.recepcion_almacenamiento(recepcion_id, num_bin) values ('{rec}', '  ')$q$, 'check'),
      ('foto 1', $q$insert into m01_recepcion.fotos_meta(foto_id,recepcion_id,lote_id,nn,ruta,nombre,tipo_mime,tamano_bytes) values ('ZZ1','{rec}','999-999-999',1,'zz1','f','image/jpeg',1000)$q$, 'ok'),
      ('foto 2', $q$insert into m01_recepcion.fotos_meta(foto_id,recepcion_id,lote_id,nn,ruta,nombre,tipo_mime,tamano_bytes) values ('ZZ2','{rec}','999-999-999',2,'zz2','f','image/jpeg',1000)$q$, 'ok'),
      ('foto 3', $q$insert into m01_recepcion.fotos_meta(foto_id,recepcion_id,lote_id,nn,ruta,nombre,tipo_mime,tamano_bytes) values ('ZZ3','{rec}','999-999-999',3,'zz3','f','image/jpeg',1000)$q$, 'ok'),
      ('foto 4', $q$insert into m01_recepcion.fotos_meta(foto_id,recepcion_id,lote_id,nn,ruta,nombre,tipo_mime,tamano_bytes) values ('ZZ4','{rec}','999-999-999',4,'zz4','f','image/jpeg',1000)$q$, 'ok'),
      ('foto 5', $q$insert into m01_recepcion.fotos_meta(foto_id,recepcion_id,lote_id,nn,ruta,nombre,tipo_mime,tamano_bytes) values ('ZZ5','{rec}','999-999-999',5,'zz5','f','image/jpeg',1000)$q$, 'ok'),
      ('la sexta foto', $q$insert into m01_recepcion.fotos_meta(foto_id,recepcion_id,lote_id,nn,ruta,nombre,tipo_mime,tamano_bytes) values ('ZZ6','{rec}','999-999-999',5,'zz6','f','image/jpeg',1000)$q$, 'E_FOTOS'),
      ('foto en formato PDF', $q$delete from m01_recepcion.fotos_meta where foto_id = 'ZZ5'; insert into m01_recepcion.fotos_meta(foto_id,recepcion_id,lote_id,nn,ruta,nombre,tipo_mime,tamano_bytes) values ('ZZP','{rec}','999-999-999',5,'zzp','f','application/pdf',1000)$q$, 'check'),
      ('foto de más de 5 MB', $q$delete from m01_recepcion.fotos_meta where foto_id = 'ZZ5'; insert into m01_recepcion.fotos_meta(foto_id,recepcion_id,lote_id,nn,ruta,nombre,tipo_mime,tamano_bytes) values ('ZZG','{rec}','999-999-999',5,'zzg','f','image/jpeg',5242881)$q$, 'check'),
      ('ruta de foto repetida', $q$delete from m01_recepcion.fotos_meta where foto_id = 'ZZ5'; insert into m01_recepcion.fotos_meta(foto_id,recepcion_id,lote_id,nn,ruta,nombre,tipo_mime,tamano_bytes) values ('ZZR','{rec}','999-999-999',5,'zz1','f','image/jpeg',1000)$q$, 'ruta_key'),
      ('tablas cerradas: un usuario con sesión no puede leer', $q$set local role authenticated; select * from m01_recepcion.recepciones$q$, 'permission denied'),
      ('tablas cerradas: el acceso anónimo no puede leer', $q$set local role anon; select * from m01_recepcion.recepciones$q$, 'permission denied'),
      ('borrado con permiso explícito (solo administración)', $q$select set_config('prodmazul.permitir_borrado', 'si', true); delete from m01_recepcion.recepciones where recepcion_id = '{rec}'$q$, 'ok'),
      ('al borrar, se borran también las gavetas', $q$select 1/(case when (select count(*) from m01_recepcion.recepcion_gavetas where recepcion_id = '{rec}') = 0 then 1 else 0 end)$q$, 'ok'),
      ('al borrar, se borran también las fotos', $q$select 1/(case when (select count(*) from m01_recepcion.fotos_meta where recepcion_id = '{rec}') = 0 then 1 else 0 end)$q$, 'ok')
    ) as x(nombre, instruccion, esperado)
  loop
    v_sql := replace(replace(replace(t.instruccion, '{rec}', v_rec), '{prov}', v_prov::text), '{esp}', v_esp::text);
    begin
      execute v_sql;
      if t.esperado = 'ok' then
        v_ok := v_ok + 1;
      else
        v_mal := v_mal + 1;
        v_txt := v_txt || E'\n  ✘ ' || t.nombre || ' (se aceptó y debía rechazarse)';
      end if;
    exception when others then
      v_err := sqlerrm;
      if t.esperado <> 'ok' and v_err ~* t.esperado then
        v_ok := v_ok + 1;
      else
        v_mal := v_mal + 1;
        v_txt := v_txt || E'\n  ✘ ' || t.nombre || ' → ' || left(v_err, 160);
      end if;
    end;
    -- cada prueba que cambió el rol lo restablece
    reset role;
  end loop;

  raise exception E'PRUEBAS DE LA PARTE 2: % correctas, % con fallo.%\n\n(Este mensaje de error es normal: sirve para deshacer los datos de prueba. No quedó nada guardado.)',
    v_ok, v_mal, v_txt;
end
$prueba$;
