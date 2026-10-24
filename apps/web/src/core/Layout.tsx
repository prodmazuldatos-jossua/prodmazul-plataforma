import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { useUnidad } from '../lib/unidades';
import { useOnline } from '../lib/conexion';
import { Alerta } from './ui';

export default function Layout() {
  const { perfil, cerrarSesion } = useAuth();
  const { unidad, setUnidad } = useUnidad();
  const online = useOnline();
  const modulos = perfil?.modulos ?? [];

  return (
    <div className="app">
      <aside className="lateral">
        <img src="/logo.png" alt="Prodmazul S.A." className="logo-lateral" />
        <nav aria-label="Principal">
          <NavLink to="/" end>Inicio</NavLink>
          {modulos.map((m) => <NavLink key={m.modulo_id} to={m.ruta}>{m.nombre}</NavLink>)}
          <NavLink to="/cuenta/clave">Cambiar mi contraseña</NavLink>
        </nav>
        <div className="lateral-pie">
          <p className="usuario">{perfil?.nombre || perfil?.correo}</p>
          <button className="boton-secundario boton-ancho" onClick={() => void cerrarSesion()}>Cerrar sesión</button>
        </div>
      </aside>
      <div className="principal">
        <header className="barra">
          <div className="estado-red" role="status">
            <span className={`punto ${online ? 'punto-ok' : 'punto-sin'}`} aria-hidden="true" />
            {online ? 'En línea' : 'Sin conexión'}
          </div>
          <div className="interruptor" role="group" aria-label="Unidad de peso">
            <button className={unidad === 'lb' ? 'activo' : ''} onClick={() => setUnidad('lb')} aria-pressed={unidad === 'lb'}>Lb</button>
            <button className={unidad === 'kg' ? 'activo' : ''} onClick={() => setUnidad('kg')} aria-pressed={unidad === 'kg'}>Kg</button>
          </div>
        </header>
        {!online && <Alerta tipo="aviso">Sin conexión. Algunas acciones necesitan señal. Cuando vuelva, la aplicación se actualiza sola.</Alerta>}
        <main className="contenido"><Outlet /></main>
      </div>
    </div>
  );
}
