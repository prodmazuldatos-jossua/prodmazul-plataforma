-- Prodmazul · Fase 5 · Partes 3 y 4 · Consultas del exportador (datos y fotos) (Supabase > SQL Editor)
-- Copia y ejecuta UNA consulta a la vez. Solo las que dicen «MODIFICA» cambian algo; las demás solo leen.
-- NUNCA ejecutes «select * from vault.decrypted_secrets»: mostraría los secretos en pantalla.

-- 1) Las últimas ejecuciones del exportador (la más reciente arriba)
select ejecucion_id, origen, estado, lotes, filas, quedan, fotos, fotos_error, quedan_fotos,
       to_char(pedida_en at time zone 'America/Guayaquil', 'DD/MM HH24:MI:SS') as pedida_ecuador,
       round(extract(epoch from (terminada_en - iniciada_en))::numeric, 1) as segundos,
       error
from core.sync_ejecuciones order by ejecucion_id desc limit 15;

-- 2) Resumen de la cola por estado
select estado, count(*) as filas from core.sync_cola group by estado order by estado;

-- 3) Estado general de la sincronización (una sola fila)
select * from core.sync_estado;

-- 4) ¿Está programada la tarea de cada 2 horas?
select jobid, jobname, schedule, active from cron.job where jobname like 'prodmazul-sync%' order by jobname;

-- 5) Cómo le fue a la tarea programada en sus últimas ejecuciones (lo registra pg_cron)
select j.jobname, d.status, d.return_message,
       to_char(d.start_time at time zone 'America/Guayaquil', 'DD/MM HH24:MI:SS') as inicio_ecuador
from cron.job_run_details d join cron.job j using (jobid)
where j.jobname like 'prodmazul-sync%' order by d.start_time desc limit 10;

-- 6) Respuesta HTTP de la función a las últimas peticiones (pg_net guarda las respuestas unas horas)
select id, status_code, timed_out, error_msg, left(content::text, 300) as respuesta, created
from net._http_response order by id desc limit 10;

-- 7) Qué secretos hay en Vault (solo los NOMBRES; nunca el valor)
select name, created_at from vault.secrets where name in ('sync_funcion_url', 'sync_secreto') order by name;

-- 8) Cuántas filas tiene cada tabla en la base (para compararlas con las pestañas de Google)
select 'proveedores' as hoja, count(*) as filas from core.proveedores
union all select 'especies', count(*) from core.especies
union all select 'lotes', count(*) from core.lotes
union all select 'perfiles', count(*) from core.perfiles
union all select 'usuario_modulo_rol', count(*) from core.usuario_modulo_rol
union all select 'config', count(*) from core.config
union all select 'recepciones', count(*) from m01_recepcion.recepciones
union all select 'recepcion_gavetas', count(*) from m01_recepcion.recepcion_gavetas
union all select 'recepcion_temperaturas', count(*) from m01_recepcion.recepcion_temperaturas
union all select 'recepcion_almacenamiento', count(*) from m01_recepcion.recepcion_almacenamiento
union all select 'fotos_meta', count(*) from m01_recepcion.fotos_meta
order by 1;

-- 9) Filas con error (con su mensaje y cuándo se reintentan)
select cola_id, tabla, clave, intentos, ultimo_error, proximo_intento_en,
       case when intentos >= (select (valor #>> '{}')::int from core.config where clave = 'sync_max_intentos') then 'AGOTADA' else 'se reintentará' end as situacion
from core.sync_cola where estado = 'error' order by cola_id;

-- 10) MODIFICA: pedir al exportador que trabaje ahora («sincronizar ahora»). Después de ~30 segundos ejecuta la consulta 1.
-- select core.sync_disparar('manual');

-- 11) MODIFICA: programar el envío automático cada 2 horas (necesita los secretos de Vault)
-- select core.sync_programar();

-- 12) MODIFICA: pausar el envío automático (no borra nada; la cola sigue anotando cambios)
-- select core.sync_pausar();

-- 13) MODIFICA: devolver a la cola las filas con error (después de corregir la causa)
-- update core.sync_cola set intentos = 0, proximo_intento_en = null where estado = 'error';

-- 14) MODIFICA: no esperar los minutos de espera de las filas con error (reintentar en la próxima ejecución)
-- update core.sync_cola set proximo_intento_en = now() where estado = 'error' and intentos < 5;

-- 15) MODIFICA: volver a anotar TODO lo que hay en la base (por ejemplo, para llenar un libro nuevo de Google)
-- select core.sync_encolar_todo();

-- 16) MODIFICA: volver a anotar solo los catálogos (proveedores, especies, lotes, perfiles, roles, parámetros)
-- select core.sync_encolar_catalogos();

-- 17) MODIFICA: cambiar el tamaño del lote (ejemplo: 100 filas en vez de 200, si Google se demora)
-- update core.config set valor = '100'::jsonb where clave = 'sync_tamano_lote';

-- ================================================================ PARTE 4 · RESPALDO DE FOTOS EN DRIVE
-- 18) Resumen de fotos: respaldadas, pendientes, con error y agotadas
select count(*) filter (where drive_file_id is not null)                                        as respaldadas,
       count(*) filter (where confirmada and drive_file_id is null and purgada_supabase_en is null) as sin_respaldo,
       count(*) filter (where not confirmada)                                                    as sin_confirmar,
       count(*)                                                                                  as total
from m01_recepcion.fotos_meta;

-- 19) Fotos con problemas (con su mensaje y cuándo se reintentan). «AGOTADA» = se alcanzó el máximo de intentos.
select s.foto_id, s.intentos, s.ultimo_error, s.proximo_intento_en,
       case when s.intentos >= (select (valor #>> '{}')::int from core.config where clave = 'sync_max_intentos') then 'AGOTADA' else 'se reintentará' end as situacion
from core.sync_fotos s order by s.actualizado_en desc;

-- 20) Fotos respaldadas por mes (compara con la prueba «contar_fotos» del paso de comparación de la guía).
--     «recepciones» cuenta las recepciones que tienen al menos una foto respaldada ese mes.
select to_char(r.fecha_llegada, 'YYYY-MM') as mes,
       count(distinct f.recepcion_id) as recepciones,
       count(*) as fotos_respaldadas
from m01_recepcion.fotos_meta f join m01_recepcion.recepciones r using (recepcion_id)
where f.drive_file_id is not null
group by 1 order by 1 desc;

-- 21) Las últimas 20 fotos respaldadas (para abrir una en Drive y comprobarla)
select f.foto_id, f.recepcion_id, f.nn, f.tamano_bytes, f.drive_file_id,
       to_char(f.respaldo_drive_en at time zone 'America/Guayaquil', 'DD/MM HH24:MI:SS') as respaldada_ecuador
from m01_recepcion.fotos_meta f where f.drive_file_id is not null order by f.respaldo_drive_en desc limit 20;

-- 22) Espacio que ocupan las fotos de Supabase (en MB). Úsalo para estimar el espacio que necesitas en Drive.
select count(*) as fotos, round(sum(tamano_bytes) / 1048576.0, 1) as megabytes_en_supabase
from m01_recepcion.fotos_meta where purgada_supabase_en is null;

-- 23) MODIFICA: dejar las fotos con error listas para reintentar ya (sin esperar los minutos de espera)
-- update core.sync_fotos set proximo_intento_en = null where intentos < 5;

-- 24) MODIFICA: devolver a la cola las fotos «agotadas» y con error (después de corregir la causa)
-- update core.sync_fotos set intentos = 0, proximo_intento_en = null, reservado_hasta = null;

-- 25) MODIFICA: repetir el respaldo de UNA foto (por ejemplo, si la borraron de Drive por error). Cambia el identificador.
--     Si el archivo sigue en Drive, el receptor lo reutiliza y no crea otro.
-- select core.sync_fotos_olvidar('FOT-M01-...-...-01');
