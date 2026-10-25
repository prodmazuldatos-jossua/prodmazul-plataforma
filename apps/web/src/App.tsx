import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './core/auth/AuthContext';
import { UnidadProvider } from './lib/unidades';
import PaginaLogin from './core/auth/PaginaLogin';
import PaginaCambiarClave from './core/auth/PaginaCambiarClave';
import RutaProtegida, { RequiereModulo } from './core/auth/RutaProtegida';
import Layout from './core/Layout';
import Inicio from './core/Inicio';
import { MODULOS } from './modules';

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
