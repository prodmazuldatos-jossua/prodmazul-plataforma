import { useAuth } from '../../core/auth/AuthContext';
import { Alerta } from '../../core/ui';

const ETIQUETAS: Record<string, string> = {
  ver: 'Ver registros', crear: 'Crear registros', editar: 'Editar registros', anular: 'Anular registros',
  eliminar: 'Eliminar y reactivar', cargar_imagenes: 'Cargar fotos', ver_reportes: 'Ver reportes', admin_config: 'Administrar configuración',
};
const ROLES: Record<string, string> = {
  admin_general: 'Administrador general', admin_modulo: 'Administrador de módulo', operativo: 'Usuario operativo', consulta: 'Usuario de consulta',
};

/** Página provisional del módulo: confirma el acceso y los permisos. El formulario llega en la Parte 2. */
export default function PaginaM01() {
  const { perfil } = useAuth();
  const acceso = perfil?.modulos.find((m) => m.modulo_id === 'M01');
  return (
    <>
      <h1>Recepción</h1>
      <Alerta tipo="info">El formulario, el listado y las demás pantallas de este módulo se activan en la Parte 2.</Alerta>
      <section className="tarjeta">
        <h2>Tu acceso a este módulo</h2>
        <p><strong>Rol:</strong> {acceso ? ROLES[acceso.rol_id] ?? acceso.rol_id : 'Sin acceso'}</p>
        <p><strong>Permisos:</strong></p>
        <ul>
          {(acceso?.permisos ?? []).map((p) => <li key={p}>{ETIQUETAS[p] ?? p}</li>)}
        </ul>
      </section>
    </>
  );
}
