import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './core/auth/AuthContext';
import { UnidadProvider } from './lib/unidades';
import PaginaLogin from './core/auth/PaginaLogin';
import PaginaCambiarClave from './core/auth/PaginaCambiarClave';
import RutaProtegida, { RequiereModulo } from './core/auth/RutaProtegida';
import Layout from './core/Layout';
import Inicio from './core/Inicio';
import { MODULOS } from './modules';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <UnidadProvider>
          <Routes>
            <Route path="/login" element={<PaginaLogin />} />
            <Route element={<RutaProtegida />}>
              <Route element={<Layout />}>
                <Route index element={<Inicio />} />
                <Route path="/cuenta/clave" element={<PaginaCambiarClave />} />
                {MODULOS.map((m) => (
                  <Route key={m.id} path={`${m.ruta}/*`} element={<RequiereModulo id={m.id}><m.componente /></RequiereModulo>} />
                ))}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
        </UnidadProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
