import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { useUnidad } from '../lib/unidades';
import { useOnline } from '../lib/conexion';
import { Alerta } from './ui';
import { Sincronizador, usarCola } from '../offline/usarCola';

export default function Layout() {
  const { perfil, cerrarSesion } = useAuth();
  const { unidad, setUnidad } = useUnidad();
  const online = useOnline();
  const modulos = perfil?.modulos ?? [];
  const cola = usarCola();
  const [cerradoAviso, setCerradoAviso] = useState<unknown>(null);
  const verAviso = cola.ultimo && cola.ultimo !== cerradoAviso;

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
            {cola.total > 0 && (
              <Link to="/m01/pendientes" className={`chip-pendientes${cola.rechazadas > 0 ? ' chip-rechazadas' : ''}`} data-testid="chip-pendientes">
                {cola.sincronizando ? 'Enviando… ' : ''}{cola.total} {cola.total === 1 ? 'pendiente' : 'pendientes'}{cola.rechazadas > 0 ? ` (${cola.rechazadas} con problema)` : ''}
              </Link>
            )}
          </div>
          <div className="interruptor" role="group" aria-label="Unidad de peso">
            <button className={unidad === 'lb' ? 'activo' : ''} onClick={() => setUnidad('lb')} aria-pressed={unidad === 'lb'}>Lb</button>
            <button className={unidad === 'kg' ? 'activo' : ''} onClick={() => setUnidad('kg')} aria-pressed={unidad === 'kg'}>Kg</button>
          </div>
        </header>
        <Sincronizador />
        {!online && <Alerta tipo="aviso">Sin conexión. Puedes registrar recepciones nuevas: se guardan en este dispositivo y se envían solas cuando vuelva la señal. Editar, anular, eliminar y ver fotos necesitan señal.</Alerta>}
        {verAviso && cola.ultimo && (
          <Alerta tipo={cola.ultimo.rechazadas > 0 ? 'aviso' : 'exito'}>
            {cola.ultimo.enviadas > 0 && <>Se {cola.ultimo.enviadas === 1 ? 'envió 1 recepción pendiente' : `enviaron ${cola.ultimo.enviadas} recepciones pendientes`}. </>}
            {cola.ultimo.rechazadas > 0 && <>{cola.ultimo.rechazadas === 1 ? '1 fue rechazada' : `${cola.ultimo.rechazadas} fueron rechazadas`}: <Link to="/m01/pendientes">revísalas aquí</Link>. </>}
            <button type="button" className="boton-enlace" onClick={() => setCerradoAviso(cola.ultimo)}>Cerrar aviso</button>
          </Alerta>
        )}
        <main className="contenido"><Outlet /></main>
      </div>
    </div>
  );
}
