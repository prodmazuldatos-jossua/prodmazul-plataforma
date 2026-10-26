-- Prodmazul · Fase 4 · Parte 12 · Verificación de una copia restaurada (solo lee).
-- Muestra cuántos datos hay y las últimas recepciones, consultadas por la misma función que usa la aplicación.
select 'recepciones'            as dato, count(*)::text as cantidad from m01_recepcion.recepciones
union all select 'gavetas pesadas',       count(*)::text from m01_recepcion.recepcion_gavetas
union all select 'lecturas de temperatura', count(*)::text from m01_recepcion.recepcion_temperaturas
union all select 'filas de almacenamiento', count(*)::text from m01_recepcion.recepcion_almacenamiento
union all select 'fotos registradas',     count(*)::text from m01_recepcion.fotos_meta
union all select 'lotes',                 count(*)::text from core.lotes
union all select 'proveedores',           count(*)::text from core.proveedores
union all select 'usuarios (perfiles)',   count(*)::text from core.perfiles
union all select 'cuentas de acceso',     count(*)::text from auth.users
union all select 'eventos de auditoría',  count(*)::text from core.auditoria;

-- Las 5 recepciones más recientes, vistas como administrador (igual que en la aplicación).
begin;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_id from core.perfiles where es_admin_general and activo order by creado_en limit 1), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select user_id::text from core.perfiles where es_admin_general and activo order by creado_en limit 1), true);
set local role authenticated;
select i->>'recepcion_id' as recepcion, i->>'fecha_llegada' as fecha, i->>'proveedor_nombre' as proveedor, i->>'lote_id' as lote, i->>'estado' as estado, i->>'libras_planta' as libras_planta
from jsonb_array_elements((public.api_m01_listar_recepciones('{"estado":"todos","limite":5,"desplazamiento":0}'::jsonb))->'items') i;
rollback;
