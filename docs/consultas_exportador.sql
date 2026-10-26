-- Prodmazul · Fase 5 · Parte 3 · Consultas del exportador (Supabase > SQL Editor)
-- Copia y ejecuta UNA consulta a la vez. Solo las que dicen «MODIFICA» cambian algo; las demás solo leen.
-- NUNCA ejecutes «select * from vault.decrypted_secrets»: mostraría los secretos en pantalla.

-- 1) Las últimas ejecuciones del exportador (la más reciente arriba)
select ejecucion_id, origen, estado, lotes, filas, quedan,
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
