import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './core/auth/AuthContext';
import { UnidadProvider } from './lib/unidades';
import PaginaLogin from './core/auth/PaginaLogin';
import PaginaCambiarClave from './core/auth/PaginaCambiarClave';
import RutaProtegida, { RequiereModulo } from './core/auth/RutaProtegida';
import Layout from './core/Layout';
import Inicio from './core/Inicio';
import { MODULOS } from './modules';
import { lazy } from 'react';
import { useAuth } from './core/auth/AuthContext';

const PaginaUsuarios = lazy(() => import('./core/admin/PaginaUsuarios'));
const PaginaRespaldo = lazy(() => import('./core/respaldo/PaginaRespaldo'));
const PaginaConfiguracion = lazy(() => import('./core/administracion/PaginaConfiguracion'));
const PaginaAuditoria = lazy(() => import('./core/administracion/PaginaAuditoria'));
const PaginaLotes = lazy(() => import('./core/administracion/PaginaLotes'));
const PaginaCatalogo = lazy(() => import('./core/administracion/PaginaCatalogo'));

/** Solo el administrador general entra a las pantallas de administración. */
function SoloAdmin({ children }: { children: React.ReactNode }) {
  const { perfil } = useAuth();
  return perfil?.es_admin_general ? <>{children}</> : <Navigate to="/" replace />;
}

/** Respaldo, configuración, auditoría, lotes y catálogo: administrador general o quien tenga el permiso de configuración del módulo 1. */
function SoloAdminRespaldo({ children }: { children: React.ReactNode }) {
  const { perfil, puede } = useAuth();
  return perfil?.es_admin_general || puede('M01', 'admin_config') ? <>{children}</> : <Navigate to="/" replace />;
}

// Se usa un enrutador de datos para poder avisar al salir de un formulario con cambios sin guardar.
const router = createBrowserRouter([
  { path: '/login', element: <PaginaLogin /> },
  {
    element: <RutaProtegida />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Inicio /> },
          { path: '/cuenta/clave', element: <PaginaCambiarClave /> },
          { path: '/admin/usuarios', element: <SoloAdmin><PaginaUsuarios /></SoloAdmin> },
          { path: '/admin/respaldo', element: <SoloAdminRespaldo><PaginaRespaldo /></SoloAdminRespaldo> },
          { path: '/admin/configuracion', element: <SoloAdminRespaldo><PaginaConfiguracion /></SoloAdminRespaldo> },
          { path: '/admin/auditoria', element: <SoloAdminRespaldo><PaginaAuditoria /></SoloAdminRespaldo> },
          { path: '/admin/lotes', element: <SoloAdminRespaldo><PaginaLotes /></SoloAdminRespaldo> },
          { path: '/admin/catalogo', element: <SoloAdminRespaldo><PaginaCatalogo /></SoloAdminRespaldo> },
          ...MODULOS.map((m) => ({ path: `${m.ruta}/*`, element: <RequiereModulo id={m.id}><m.componente /></RequiereModulo> })),
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return (
    <AuthProvider>
      <UnidadProvider>
        <RouterProvider router={router} />
      </UnidadProvider>
    </AuthProvider>
  );
}
