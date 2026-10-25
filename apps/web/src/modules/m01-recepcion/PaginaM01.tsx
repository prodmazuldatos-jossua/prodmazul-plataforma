import { Link, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthContext';
import { Alerta, Vacio } from '../../core/ui';
import FormularioRecepcion from './FormularioRecepcion';

const ROLES: Record<string, string> = {
  admin_general: 'Administrador general', admin_modulo: 'Administrador de módulo', operativo: 'Usuario operativo', consulta: 'Usuario de consulta',
};

function InicioM01() {
  const { perfil, puede } = useAuth();
  const acceso = perfil?.modulos.find((m) => m.modulo_id === 'M01');
  return (
    <>
      <h1>Recepción</h1>
      <p className="texto-suave">Tu rol: <strong>{acceso ? ROLES[acceso.rol_id] ?? acceso.rol_id : 'Sin acceso'}</strong></p>
      <Alerta tipo="info">El listado de recepciones llega en la Parte 8. Por ahora puedes registrar una recepción nueva.</Alerta>
      {puede('M01', 'crear') && <Link className="boton-primario enlace-boton" to="/m01/nueva">Nueva recepción</Link>}
    </>
  );
}

function SoloCrear({ children }: { children: React.ReactNode }) {
  const { puede } = useAuth();
  if (!puede('M01', 'crear')) {
    return <Vacio titulo="Sin permiso"><p>Tu rol no permite registrar recepciones.</p></Vacio>;
  }
  return <>{children}</>;
}

export default function PaginaM01() {
  return (
    <Routes>
      <Route index element={<InicioM01 />} />
      <Route path="nueva" element={<SoloCrear><FormularioRecepcion /></SoloCrear>} />
      <Route path="*" element={<InicioM01 />} />
    </Routes>
  );
}
