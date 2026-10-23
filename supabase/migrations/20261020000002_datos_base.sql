-- Prodmazul · Fase 4 · Migración 3: datos base

insert into core.modulos (modulo_id, nombre, ruta, habilitado, orden) values
  ('M01', 'Recepción', '/m01', true, 1);

insert into core.roles (rol_id, nombre) values
  ('admin_modulo', 'Administrador de módulo'),
  ('operativo',    'Usuario operativo'),
  ('consulta',     'Usuario de consulta');

insert into core.permisos (permiso_id, descripcion) values
  ('ver',             'Ver registros'),
  ('crear',           'Crear registros'),
  ('editar',          'Editar registros'),
  ('anular',          'Anular registros (con motivo)'),
  ('eliminar',        'Eliminar y reactivar registros'),
  ('cargar_imagenes', 'Cargar y borrar fotos'),
  ('ver_reportes',    'Consultar reportes'),
  ('admin_config',    'Administrar la configuración del módulo');

-- El administrador general no necesita filas aquí: tiene todos los permisos (core.perfiles.es_admin_general).
insert into core.rol_permisos (rol_id, permiso_id) values
  ('admin_modulo', 'ver'), ('admin_modulo', 'crear'), ('admin_modulo', 'editar'), ('admin_modulo', 'anular'),
  ('admin_modulo', 'eliminar'), ('admin_modulo', 'cargar_imagenes'), ('admin_modulo', 'ver_reportes'),
  ('admin_modulo', 'admin_config'),
  ('operativo', 'ver'), ('operativo', 'crear'), ('operativo', 'editar'), ('operativo', 'anular'),
  ('operativo', 'cargar_imagenes'), ('operativo', 'ver_reportes'),
  ('consulta', 'ver'), ('consulta', 'ver_reportes');

insert into core.config (clave, valor) values
  ('factor_lb_kg', '2.20462'::jsonb),
  -- 3 segmentos separados por guion; cada uno: 3 números, o 3 números y una letra (antes o después).
  ('formato_lote', to_jsonb('^([A-Z]?[0-9]{3}|[0-9]{3}[A-Z]?)(-([A-Z]?[0-9]{3}|[0-9]{3}[A-Z]?)){2}$'::text)),
  ('dias_retencion_fotos', '60'::jsonb),
  ('max_fotos_recepcion', '5'::jsonb),
  ('formulario_m01', jsonb_build_object(
      'codigo', 'PROM-M-P-P5-F1-C',
      'version', '01',
      'fecha_emision', '22-02-2026',
      'departamento', 'DEPARTAMENTO DE PRODUCCION',
      'titulo', 'CONTROL DE PESOS EN RECEPCION PESCA CRUSTACEOS',
      'direccion', 'PRODMAZUL S.A  Km 3 1/2 via a la refinería del pacifico  info@prodmazul.com  Montecristi-Manabí-Ecuador'
  ));
