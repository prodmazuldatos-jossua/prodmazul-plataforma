-- Prodmazul · Fase 4 · Parte 7 · BORRA los datos de demostración (y solo ellos)
-- Cómo usarlo: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- Qué borra: recepciones con guía «DEMO-…» (con sus gavetas, temperaturas y almacenamiento), los lotes 981-981-981,
--   982-982-982 y 983-983-983, los proveedores «DEMO …» y las especies «DEMO …». No toca ningún otro dato.
-- El historial de auditoría no se borra (es de solo inserción).
-- RESULTADO ESPERADO: «Success. No rows returned».

begin;
set local prodmazul.permitir_borrado = 'si';
delete from m01_recepcion.recepciones where guia_remision like 'DEMO-%';
delete from core.lotes where lote_id in ('981-981-981', '982-982-982', '983-983-983')
  and not exists (select 1 from m01_recepcion.recepciones r where r.lote_id = core.lotes.lote_id);
delete from core.proveedores p where p.nombre like 'DEMO %'
  and not exists (select 1 from core.lotes l where l.proveedor_id = p.id);
delete from core.especies e where e.nombre like 'DEMO %'
  and not exists (select 1 from core.lotes l where l.especie_id = e.id)
  and not exists (select 1 from m01_recepcion.recepciones r where r.especie_id = e.id);
commit;
