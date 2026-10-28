-- Prodmazul · LIMPIEZA PARA EMPEZAR EN PRODUCCIÓN (base de datos)
-- ============================================================================================
-- ESTE SCRIPT BORRA DATOS DE FORMA DEFINITIVA. HAZ ANTES UNA COPIA (respaldo-diario.ps1) Y GUÁRDALA FUERA DE TU PC.
--
-- Qué BORRA (todo, incluidas las recepciones anuladas y eliminadas):
--   recepciones, gavetas, temperaturas, almacenamiento, fotos (registros), lotes, proveedores, especies, alias del catálogo,
--   contadores (el número de recepción vuelve a REC-AAAAMMDD-0001), auditoría, cola e historial de envíos a Sheets,
--   historial de la purga de fotos.
-- Qué CONSERVA (no son datos de trabajo): usuarios (perfiles), roles asignados, permisos y la configuración.
--   Deja APAGADOS el envío a Sheets (sync_activa) y la purga de fotos (purga_activa).
-- NO borra: los archivos de las fotos (Storage de Supabase) ni los de Drive, ni las hojas de Google.
--   Para eso están herramientas/limpiar-fotos-storage.mjs y apps-script/Limpieza.gs (ver la guía).
--
-- Cómo usarlo:
--   Supabase: SQL Editor > New query > pega TODO > Run.   Local: docker exec ... psql -f (la guía lo explica).
--   1) PRIMERA VEZ, tal como está: es una SIMULACIÓN. No borra nada; termina con un mensaje rojo que dice cuántos
--      registros borraría de cada tabla (ese «error» es normal: deshace todo).
--   2) Para borrar de verdad cambia 'NO' por 'SI BORRAR TODO' en la línea marcada con >>> y ejecuta de nuevo.
-- ============================================================================================

do $limpieza$
declare
  v_confirmo text := 'NO';          -- >>> CAMBIA 'NO' POR 'SI BORRAR TODO' PARA BORRAR DE VERDAD
  v_tablas   text[] := array[
    'm01_recepcion.fotos_meta','m01_recepcion.recepcion_almacenamiento','m01_recepcion.recepcion_temperaturas',
    'm01_recepcion.recepcion_gavetas','m01_recepcion.recepciones','m01_recepcion.contadores',
    'core.lotes','core.catalogo_alias','core.proveedores','core.especies',
    'core.sync_fotos','core.purga_fotos','core.sync_cola','core.sync_ejecuciones','core.purga_ejecuciones','core.auditoria'];
  v_conservan text[] := array['core.perfiles','core.usuario_modulo_rol','core.config'];
  t text; v_n bigint; v_resumen text := ''; v_cuentas jsonb := '{}'::jsonb; v_cola bigint;
begin
  foreach t in array v_tablas loop
    execute format('select count(*) from %s', t) into v_n;
    v_cuentas := v_cuentas || jsonb_build_object(t, v_n);
    v_resumen := v_resumen || E'\n  ' || rpad(t, 44) || v_n;
  end loop;

  if v_confirmo <> 'SI BORRAR TODO' then
    raise exception E'SIMULACIÓN: no se borró nada. Se borrarían:%\n\nPara borrar de verdad, cambia ''NO'' por ''SI BORRAR TODO'' en la línea marcada con >>> y ejecuta otra vez.', v_resumen;
  end if;

  -- TRUNCATE no dispara los candados de «no borrar» ni la cola de envío: es lo que se quiere en una limpieza total.
  truncate table
    m01_recepcion.fotos_meta, m01_recepcion.recepcion_almacenamiento, m01_recepcion.recepcion_temperaturas,
    m01_recepcion.recepcion_gavetas, m01_recepcion.recepciones, m01_recepcion.contadores,
    core.sync_fotos, core.purga_fotos, core.lotes, core.catalogo_alias, core.proveedores, core.especies,
    core.sync_cola, core.sync_ejecuciones, core.purga_ejecuciones, core.auditoria
    restart identity;

  update core.sync_estado set ultima_sync_ok_en = null, ultimo_intento_en = null, ultimo_error = null, ultimo_error_en = null,
         lotes_enviados = 0, filas_enviadas = 0, lotes_con_error = 0, fotos_respaldadas = 0,
         ultima_foto_ok_en = null, ultimo_error_foto = null, ultimo_error_foto_en = null;

  -- Los envíos y la purga quedan APAGADOS hasta que termines la limpieza de Google (la guía dice cuándo encenderlos).
  update core.config set valor = 'false'::jsonb where clave in ('sync_activa', 'purga_activa');

  -- Se vuelve a anotar lo que se conserva (usuarios y configuración) para que la copia de Sheets quede completa.
  perform core.sync_encolar_catalogos();
  select count(*) into v_cola from core.sync_cola;

  insert into core.auditoria (modulo_id, accion, entidad, resultado, detalle)
  values (null, 'limpieza_produccion', 'base_de_datos', 'ok',
          jsonb_build_object('borrado', v_cuentas, 'conservado', to_jsonb(v_conservan), 'pendientes_para_sheets', v_cola));
end
$limpieza$;

-- Comprobación (se muestra solo si pusiste 'SI BORRAR TODO'): todo en 0 salvo lo que se conserva y la anotación de la limpieza.
select tabla, filas from (
  select 'recepciones' as tabla, count(*) as filas, 1 as o from m01_recepcion.recepciones
  union all select 'recepcion_gavetas', count(*), 2 from m01_recepcion.recepcion_gavetas
  union all select 'recepcion_temperaturas', count(*), 3 from m01_recepcion.recepcion_temperaturas
  union all select 'recepcion_almacenamiento', count(*), 4 from m01_recepcion.recepcion_almacenamiento
  union all select 'fotos_meta', count(*), 5 from m01_recepcion.fotos_meta
  union all select 'contadores (número de recepción)', count(*), 6 from m01_recepcion.contadores
  union all select 'lotes', count(*), 7 from core.lotes
  union all select 'proveedores', count(*), 8 from core.proveedores
  union all select 'especies', count(*), 9 from core.especies
  union all select 'auditoría (solo la anotación de esta limpieza)', count(*), 10 from core.auditoria
  union all select 'CONSERVADO: perfiles', count(*), 11 from core.perfiles
  union all select 'CONSERVADO: usuario_modulo_rol', count(*), 12 from core.usuario_modulo_rol
  union all select 'CONSERVADO: config', count(*), 13 from core.config
  union all select 'envío a Sheets APAGADO (sync_activa)', case when (select valor from core.config where clave = 'sync_activa') = 'false'::jsonb then 1 else 0 end, 14
) x order by o;
