-- Prodmazul · Fase 5 · Consultas de la cola de sincronización (Supabase > SQL Editor)
-- Copia y ejecuta UNA consulta a la vez. Solo las que dicen «MODIFICA» cambian algo; las demás solo leen.

-- 1) Resumen de la cola por estado
select estado, count(*) as filas, min(cambiado_en) as mas_antigua, max(cambiado_en) as mas_reciente
from core.sync_cola group by estado order by estado;

-- 2) Pendientes por tabla (qué falta enviar)
select tabla, count(*) as pendientes
from core.sync_cola where estado = 'pendiente' group by tabla order by tabla;

-- 3) Estado general de la sincronización (una sola fila)
select * from core.sync_estado;

-- 4) Los últimos 30 cambios anotados
select cola_id, tabla, operacion, estado, intentos, clave, cambiado_en
from core.sync_cola order by cola_id desc limit 30;

-- 5) Filas con error (con su mensaje y cuándo se reintentan)
select cola_id, tabla, clave, intentos, ultimo_error, proximo_intento_en,
       case when intentos >= (select (valor #>> '{}')::int from core.config where clave = 'sync_max_intentos') then 'AGOTADA' else 'se reintentará' end as situacion
from core.sync_cola where estado = 'error' order by cola_id;

-- 6) Parámetros de la sincronización
select clave, valor from core.config where clave like 'sync\_%' order by clave;

-- 7) Las tablas que se copian a Google Sheets
select orden, tabla, hoja, columnas_clave from core.sync_tablas order by orden;

-- 8) MODIFICA: cambiar un parámetro (ejemplo: lotes de 100 filas en vez de 200)
-- update core.config set valor = '100'::jsonb where clave = 'sync_tamano_lote';

-- 9) MODIFICA: devolver a la cola las filas con error (después de corregir la causa)
-- update core.sync_cola set intentos = 0, proximo_intento_en = null where estado = 'error';

-- 10) MODIFICA: volver a anotar TODO lo que hay en la base (para llenar un libro nuevo de Google)
-- select core.sync_encolar_todo();

-- 11) MODIFICA: prueba a mano de un lote (¡RESERVA las filas!; confirma o falla el lote para soltarlas)
-- select jsonb_pretty(public.sync_proximo_lote(3));
-- select public.sync_marcar_enviado('PEGA_AQUI_EL_LOTE_ID'::uuid);          -- confirmar
-- select public.sync_marcar_error('PEGA_AQUI_EL_LOTE_ID'::uuid, 'prueba');   -- o fallar
