-- Prodmazul · Borrar definitivamente una recepción (SOLO datos de prueba)
-- Las recepciones reales NUNCA se borran: se anulan o se eliminan (cambio de estado) desde la aplicación.
-- Esta consulta es una excepción para el administrador de la base de datos y sirve para limpiar pruebas.
-- Se borran también sus gavetas, temperaturas, almacenamiento y registros de fotos.
-- Las FOTOS del almacenamiento (Storage) no se borran con esta consulta: bórralas en Storage > m01-recepcion-fotos.
-- La auditoría conserva el rastro de lo que se hizo.
--
-- Cómo usarla: SQL Editor > New query > reemplaza GUIA_DE_LA_RECEPCION > Run (todo el bloque junto).

begin;
set local prodmazul.permitir_borrado = 'si';
delete from m01_recepcion.recepciones where guia_remision = 'GUIA_DE_LA_RECEPCION';
commit;

-- Comprobación: debe devolver 0 filas
select recepcion_id, guia_remision, estado from m01_recepcion.recepciones where guia_remision = 'GUIA_DE_LA_RECEPCION';
