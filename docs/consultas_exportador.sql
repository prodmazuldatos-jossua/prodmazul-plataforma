-- Prodmazul · Fase 5 · Partes 3, 4 y 5 · Consultas del exportador (datos, fotos y retención) (Supabase > SQL Editor)
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

-- ================================================================ PARTE 5 · RETENCIÓN DE 60 DÍAS
-- 26) ¿Está encendida la purga, cuántos días es la retención y está programada la tarea diaria?
select (select valor from core.config where clave = 'purga_activa')          as purga_activa,
       (select valor from core.config where clave = 'dias_retencion_fotos')  as dias_retencion,
       (select valor from core.config where clave = 'purga_gracia_horas')    as gracia_horas,
       (select schedule from cron.job where jobname = 'prodmazul-purga-fotos') as programacion_utc;

-- 27) Las últimas corridas de la purga (la más reciente arriba)
select purga_id, origen, estado, candidatas, purgadas, omitidas, errores, quedan,
       to_char(pedida_en at time zone 'America/Guayaquil', 'DD/MM HH24:MI:SS') as pedida_ecuador, error
from core.purga_ejecuciones order by purga_id desc limit 15;

-- 28) VISTA PREVIA: qué fotos se purgarían en la próxima corrida (NO borra nada)
select f.foto_id, f.recepcion_id, f.nn, f.tamano_bytes,
       to_char(f.subido_en at time zone 'America/Guayaquil', 'DD/MM/YYYY') as subida,
       to_char(f.respaldo_drive_en at time zone 'America/Guayaquil', 'DD/MM/YYYY HH24:MI') as copia_en_drive
from m01_recepcion.fotos_meta f left join core.purga_fotos p on p.foto_id = f.foto_id
where core.purga_regla(f) and coalesce(p.intentos, 0) < 5
order by f.subido_en limit 100;

-- 29) Fotos archivadas (ya no están en Supabase; solo en Drive), por mes de llegada de la recepción
select to_char(r.fecha_llegada, 'YYYY-MM') as mes, count(*) as fotos_archivadas
from m01_recepcion.fotos_meta f join m01_recepcion.recepciones r using (recepcion_id)
where f.purgada_supabase_en is not null group by 1 order by 1 desc;

-- 30) Fotos con problemas en la purga (con su motivo y cuándo se reintentan)
select p.foto_id, p.intentos, p.ultimo_error, p.proximo_intento_en,
       case when p.intentos >= 5 then 'AGOTADA' else 'se reintentará' end as situacion
from core.purga_fotos p order by p.actualizado_en desc;

-- 31) Resumen de fotos por situación: en Supabase y con copia / en Supabase sin copia / archivadas en Drive
select count(*) filter (where purgada_supabase_en is null and drive_file_id is not null) as en_supabase_con_copia,
       count(*) filter (where purgada_supabase_en is null and drive_file_id is null and confirmada) as en_supabase_sin_copia,
       count(*) filter (where purgada_supabase_en is not null) as archivadas_en_drive
from m01_recepcion.fotos_meta;

-- 32) MODIFICA: encender la purga y programar la tarea diaria (03:30 hora de Ecuador). Necesita los secretos de Vault.
-- select core.purga_programar();

-- 33) MODIFICA: apagar la purga (quita la tarea; no borra nada)
-- select core.purga_pausar();

-- 34) MODIFICA: pedir una corrida ahora (después de ~40 segundos ejecuta la consulta 27)
-- select core.purga_disparar('manual');

-- 35) MODIFICA: devolver a la cola las fotos con error de purga (después de corregir la causa)
-- update core.purga_fotos set intentos = 0, proximo_intento_en = null;

-- 36) MODIFICA SOLO PARA PRUEBAS: envejecer UNA foto de prueba para que la purga la considere (cambia el identificador).
--     Nunca lo uses con fotos reales.
-- update m01_recepcion.fotos_meta set subido_en = now() - interval '70 days', respaldo_drive_en = now() - interval '2 days'
--  where foto_id = 'FOT-M01-...-...-01' and drive_file_id is not null;

-- 37) Estado del respaldo en cifras (lo mismo que ve la aplicación en «Estado del respaldo»)
select (select valor from core.config where clave = 'sync_activa') as respaldo_encendido,
       (select valor from core.config where clave = 'sync_alerta_horas') as limite_horas_aviso,
       e.ultima_sync_ok_en,
       round(extract(epoch from (now() - e.ultima_sync_ok_en)) / 60) as minutos_sin_sincronizar,
       (select count(*) from core.sync_cola where estado in ('pendiente','enviando')) as cambios_por_enviar,
       (select count(*) from core.sync_cola where estado = 'error') as envios_con_error,
       (select count(*) from m01_recepcion.fotos_meta where confirmada and drive_file_id is null and purgada_supabase_en is null) as fotos_sin_respaldo
from core.sync_estado e where e.id = 1;

-- 38) MODIFICA SOLO PARA PRUEBAS: simular que hace 7 horas que no se sincroniza (la aplicación mostrará el aviso en rojo
--     a quienes administran en menos de un minuto). Para quitarlo: ejecuta la consulta 39 y espera a que termine la sincronización.
-- update core.sync_estado set ultima_sync_ok_en = now() - interval '7 hours' where id = 1;

-- 39) MODIFICA: pedir una sincronización ahora; al terminar bien, el reloj vuelve a cero y el aviso rojo desaparece
-- select core.sync_disparar('manual');

-- =====================================================================================================================
-- REPORTES (Parte 7). Solo lectura.
-- Las funciones de reportes revisan el permiso de quien las llama y el SQL Editor no tiene sesión de usuario. Por eso cada
-- consulta de reporte (41, 43, 45, 46 y 48) ya trae, dentro de la MISMA instrucción, el paso que «presenta» al administrador
-- general (set_config). Se copian y se ejecutan TAL CUAL, enteras y con un solo Run: no hace falta ejecutar nada antes.
-- «Hoy» se calcula con la hora de Ecuador (Supabase trabaja en hora UTC y, de noche, su «hoy» ya sería mañana).
-- Las consultas «A MANO» (42, 44, 47 y 49) no usan las funciones y no necesitan presentación.
-- =====================================================================================================================

-- 41) Reporte por MES de este año (función). Libras planta, lotes distintos y diferencia contra lo reportado.
select f.*
from (select set_config('request.jwt.claim.sub', (select user_id::text from core.perfiles where es_admin_general and activo order by creado_en limit 1), false) as c) s
cross join lateral (select public.api_m01_rep_periodos(date_trunc('year', now() at time zone 'America/Guayaquil')::date, (now() at time zone 'America/Guayaquil')::date, 'mes') as r where s.c is not null) x
cross join lateral jsonb_to_recordset(x.r->'filas') as f(inicio date, fin date, parcial boolean, recepciones int, lotes int, libras_planta numeric, libras_reportadas numeric, diferencia_lb numeric, diferencia_pct numeric);

-- 42) LO MISMO «A MANO» (sin usar la función): debe dar los mismos números que la consulta 41 en los meses con recepciones
select date_trunc('month', fecha_llegada::timestamp)::date as inicio, count(*) as recepciones, count(distinct lote_id) as lotes,
       sum(libras_planta) as libras_planta, sum(libras_reportadas) as libras_reportadas
from m01_recepcion.recepciones
where estado = 'cerrado' and fecha_llegada between date_trunc('year', now() at time zone 'America/Guayaquil')::date and (now() at time zone 'America/Guayaquil')::date
group by 1 order by 1;

-- 43) Reporte por SEMANA (lunes a domingo) de los últimos 60 días (función)
select f.*
from (select set_config('request.jwt.claim.sub', (select user_id::text from core.perfiles where es_admin_general and activo order by creado_en limit 1), false) as c) s
cross join lateral (select public.api_m01_rep_periodos((now() at time zone 'America/Guayaquil')::date - 59, (now() at time zone 'America/Guayaquil')::date, 'semana') as r where s.c is not null) x
cross join lateral jsonb_to_recordset(x.r->'filas') as f(inicio date, fin date, parcial boolean, recepciones int, lotes int, libras_planta numeric, libras_reportadas numeric, diferencia_lb numeric, diferencia_pct numeric);

-- 44) LO MISMO «A MANO» por semana (la semana empieza el lunes)
select date_trunc('week', fecha_llegada::timestamp)::date as lunes, count(*) as recepciones, count(distinct lote_id) as lotes, sum(libras_planta) as libras_planta
from m01_recepcion.recepciones
where estado = 'cerrado' and fecha_llegada between (now() at time zone 'America/Guayaquil')::date - 59 and (now() at time zone 'America/Guayaquil')::date
group by 1 order by 1;

-- 45) Reporte por DÍA de los últimos 14 días (función)
select f.*
from (select set_config('request.jwt.claim.sub', (select user_id::text from core.perfiles where es_admin_general and activo order by creado_en limit 1), false) as c) s
cross join lateral (select public.api_m01_rep_periodos((now() at time zone 'America/Guayaquil')::date - 13, (now() at time zone 'America/Guayaquil')::date, 'dia') as r where s.c is not null) x
cross join lateral jsonb_to_recordset(x.r->'filas') as f(inicio date, recepciones int, lotes int, libras_planta numeric, libras_reportadas numeric);

-- 46) Proveedores del año (función): primero el total de proveedores y los totales; luego la lista con libras por proveedor
select x.r->>'proveedores_con_recepcion' as proveedores_con_recepcion, x.r->>'proveedores_catalogo' as proveedores_en_catalogo, x.r->'totales' as totales
from (select set_config('request.jwt.claim.sub', (select user_id::text from core.perfiles where es_admin_general and activo order by creado_en limit 1), false) as c) s
cross join lateral (select public.api_m01_rep_proveedores(date_trunc('year', now() at time zone 'America/Guayaquil')::date, (now() at time zone 'America/Guayaquil')::date) as r where s.c is not null) x
;
select f.*
from (select set_config('request.jwt.claim.sub', (select user_id::text from core.perfiles where es_admin_general and activo order by creado_en limit 1), false) as c) s
cross join lateral (select public.api_m01_rep_proveedores(date_trunc('year', now() at time zone 'America/Guayaquil')::date, (now() at time zone 'America/Guayaquil')::date) as r where s.c is not null) x
cross join lateral jsonb_to_recordset(x.r->'filas') as f(proveedor text, recepciones int, lotes int, libras_planta numeric, libras_reportadas numeric, diferencia_lb numeric, porcentaje numeric);

-- 47) LO MISMO «A MANO» por proveedor
select p.nombre as proveedor, count(*) as recepciones, count(distinct r.lote_id) as lotes, sum(r.libras_planta) as libras_planta
from m01_recepcion.recepciones r join core.proveedores p on p.id = r.proveedor_id
where r.estado = 'cerrado' and r.fecha_llegada between date_trunc('year', now() at time zone 'America/Guayaquil')::date and (now() at time zone 'America/Guayaquil')::date
group by p.nombre order by sum(r.libras_planta) desc;

-- 48) Especie por proveedor del año (función): la lista y, después, el total por especie
select f.*
from (select set_config('request.jwt.claim.sub', (select user_id::text from core.perfiles where es_admin_general and activo order by creado_en limit 1), false) as c) s
cross join lateral (select public.api_m01_rep_especie_proveedor(date_trunc('year', now() at time zone 'America/Guayaquil')::date, (now() at time zone 'America/Guayaquil')::date) as r where s.c is not null) x
cross join lateral jsonb_to_recordset(x.r->'filas') as f(proveedor text, especie text, recepciones int, lotes int, libras_planta numeric);

select f.*
from (select set_config('request.jwt.claim.sub', (select user_id::text from core.perfiles where es_admin_general and activo order by creado_en limit 1), false) as c) s
cross join lateral (select public.api_m01_rep_especie_proveedor(date_trunc('year', now() at time zone 'America/Guayaquil')::date, (now() at time zone 'America/Guayaquil')::date) as r where s.c is not null) x
cross join lateral jsonb_to_recordset(x.r->'por_especie') as f(especie text, recepciones int, lotes int, proveedores int, libras_planta numeric);

-- 49) Cuántas recepciones NO cuentan en los reportes y por qué (anuladas, eliminadas y borradores del año)
select estado, count(*) as recepciones, sum(libras_planta) as libras_planta
from m01_recepcion.recepciones
where fecha_llegada between date_trunc('year', now() at time zone 'America/Guayaquil')::date and (now() at time zone 'America/Guayaquil')::date
group by estado order by estado;

-- ================= Fase 5 · Parte 9: usuarios =================
-- 50) Lista de usuarios (función de la aplicación): correo, nombre, estado y roles. Cópiala ENTERA y ejecútala con un solo Run.
select f.correo, f.nombre, f.activo, f.es_admin_general, f.roles
from (select set_config('request.jwt.claim.sub', (select user_id::text from core.perfiles where es_admin_general and activo order by creado_en limit 1), false) as c) s
cross join lateral (select public.api_admin_listar_usuarios() as r where s.c is not null) x
cross join lateral jsonb_to_recordset(x.r->'usuarios') as f(correo text, nombre text, activo boolean, es_admin_general boolean, roles jsonb)
order by f.es_admin_general desc, lower(f.nombre);

-- 51) LO MISMO «A MANO» (sin usar la función): debe dar los mismos usuarios, estados y roles que la consulta 50
select p.correo, p.nombre, p.activo, p.es_admin_general,
       coalesce((select jsonb_agg(jsonb_build_object('modulo_id', r.modulo_id, 'rol_id', r.rol_id) order by r.modulo_id) from core.usuario_modulo_rol r where r.user_id = p.user_id), '[]'::jsonb) as roles
from core.perfiles p
order by p.es_admin_general desc, lower(p.nombre);

-- 52) Historial de cambios de usuarios (función): los últimos 20 eventos, del más nuevo al más antiguo
select f.creado_en, f.accion, f.quien, f.usuario_correo, f.detalle
from (select set_config('request.jwt.claim.sub', (select user_id::text from core.perfiles where es_admin_general and activo order by creado_en limit 1), false) as c) s
cross join lateral (select public.api_admin_historial_usuarios(20) as r where s.c is not null) x
cross join lateral jsonb_to_recordset(x.r->'eventos') as f(creado_en timestamptz, accion text, quien text, usuario_correo text, detalle jsonb);

-- 53) Revisión: ¿alguna auditoría de usuarios guardó una contraseña? DEBE dar 0 en las dos columnas
select count(*) filter (where detalle::text ~* '(password|contrase)') as eventos_con_password,
       count(*) filter (where detalle ? 'clave') as eventos_con_clave
from core.auditoria
where entidad = 'usuario';

-- 54) Usuarios desactivados (conservan su rol, pero no pueden trabajar)
select correo, nombre,
       (select string_agg(r.modulo_id || ': ' || r.rol_id, ', ') from core.usuario_modulo_rol r where r.user_id = p.user_id) as roles
from core.perfiles p
where not activo
order by lower(nombre);

-- 55) Auditoría «a mano»: cuántos eventos hay por acción. Compara con la pantalla Auditoría (filtro «Acción»)
select accion, count(*) as eventos, max(creado_en at time zone 'America/Guayaquil') as ultimo_ecuador
from core.auditoria
group by accion
order by eventos desc, accion;

-- 56) Configuración actual (los 8 parámetros de la pantalla Configuración). Solo lee
select clave, valor
from core.config
where clave in ('dias_retencion_fotos','purga_gracia_horas','purga_max_por_corrida','factor_lb_kg','max_fotos_recepcion','formato_lote','sync_alerta_horas','sync_dias_historial')
order by clave;

-- 57) Lotes cerrados y abiertos «a mano». Compara con la pantalla Lotes (Cerrados / Abiertos)
select count(*) filter (where cerrado) as cerrados, count(*) filter (where not cerrado) as abiertos
from core.lotes;

-- 58) Nombres de prueba del catálogo (Parte 10): recepciones y lotes de cada uno. Solo lee
select 'proveedor' as tipo, p.nombre,
       (select count(*) from m01_recepcion.recepciones r where r.proveedor_id = p.id and r.estado <> 'eliminado') as recepciones,
       (select count(*) from core.lotes l where l.proveedor_id = p.id) as lotes
from core.proveedores p where p.nombre ilike 'ZZ Prueba P10%'
union all
select 'especie', e.nombre,
       (select count(*) from m01_recepcion.recepciones r where r.especie_id = e.id and r.estado <> 'eliminado'),
       (select count(*) from core.lotes l where l.especie_id = e.id)
from core.especies e where e.nombre ilike 'ZZ Prueba P10%'
order by 1, 2;

-- 59) Alias creados al unir nombres (el nombre viejo apunta al nombre que se conservó). Solo lee
select a.tipo, a.nombre as nombre_viejo, a.unido_en at time zone 'America/Guayaquil' as unido_ecuador,
       coalesce(p.nombre, e.nombre) as se_conserva
from core.catalogo_alias a
left join core.proveedores p on a.tipo = 'proveedor' and p.id = a.destino_id
left join core.especies e on a.tipo = 'especie' and e.id = a.destino_id
order by a.unido_en desc;
