import { Navigate, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { Cargando, Vacio } from '../ui';

/** Sin sesión o sin cuenta activa: vuelve al inicio de sesión. */
export default function RutaProtegida() {
  const { session, perfil, cargando } = useAuth();
  if (cargando) return <Cargando texto="Abriendo…" />;
  if (!session) return <Navigate to="/login" replace />;
  if (!perfil) return <Cargando texto="Cargando tu perfil…" />;
  if (!perfil.activo) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Solo muestra el módulo si la persona tiene acceso; si no, «Sin acceso». */
export function RequiereModulo({ id, children }: { id: string; children: ReactNode }) {
  const { perfil } = useAuth();
  if (!perfil?.modulos.some((m) => m.modulo_id === id)) {
    return (
      <Vacio titulo="Sin acceso">
        <p>No tienes acceso a este módulo. Si lo necesitas, pide al administrador que te lo asigne.</p>
      </Vacio>
    );
  }
  return <>{children}</>;
}
