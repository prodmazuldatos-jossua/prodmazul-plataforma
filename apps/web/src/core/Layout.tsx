import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { useUnidad } from '../lib/unidades';
import { useOnline } from '../lib/conexion';
import { Alerta, Cargando } from './ui';
import { Icono, iconoDeModulo } from './iconos';
import { Sincronizador, usarCola } from '../offline/usarCola';
import { RespaldoProvider } from './respaldo/usarRespaldo';
import { AvisoRespaldo, IndicadorRespaldo } from './respaldo/IndicadorRespaldo';

function iniciales(texto: string): string {
  const partes = texto.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return (partes.length > 1 ? partes[0][0] + partes[1][0] : (partes[0] ?? '?').slice(0, 2)).toUpperCase();
}

export default function Layout() {
  const { perfil, cerrarSesion, puede } = useAuth();
  const { unidad, setUnidad } = useUnidad();
  const online = useOnline();
  const modulos = perfil?.modulos ?? [];
  const cola = usarCola();
  const [cerradoAviso, setCerradoAviso] = useState<unknown>(null);
  const verAviso = cola.ultimo && cola.ultimo !== cerradoAviso;
  const [menuAbierto, setMenuAbierto] = useState(false);
  const { pathname } = useLocation();
  const botonMenu = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  // El menú se cierra solo al navegar a otra pantalla.
  useEffect(() => { setMenuAbierto(false); }, [pathname]);

  // Con el menú abierto: Escape lo cierra, el foco se queda dentro y al cerrar vuelve al botón.
  useEffect(() => {
    if (!menuAbierto) return;
    const previo = botonMenu.current;
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenuAbierto(false); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const f = Array.from(panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
      if (f.length === 0) return;
      const primero = f[0], ultimo = f[f.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    };
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('keydown', tecla); previo?.focus(); };
  }, [menuAbierto]);

  const modulo = modulos.find((m) => pathname === m.ruta || pathname.startsWith(`${m.ruta}/`));
  const titulo = pathname === '/' ? 'Inicio' : pathname.startsWith('/cuenta') ? 'Mi cuenta' : pathname.startsWith('/admin/usuarios') ? 'Usuarios' : pathname.startsWith('/admin/respaldo') ? 'Estado del respaldo' : modulo?.nombre ?? 'Prodmazul';
  const esAdmin = perfil?.es_admin_general === true;
  const nombre = perfil?.nombre?.trim() || perfil?.correo || '';
  // Quienes administran (administrador general o permiso de configuración del módulo 1) ven el estado del respaldo.
  const veRespaldo = esAdmin || puede('M01', 'admin_config');

  return (
    <RespaldoProvider habilitado={veRespaldo}>
    <div className="app">
      <div className="principal">
        <header className="barra">
          <p className="barra-titulo">{titulo}</p>
          <div className="barra-datos">
            <div className="estado-red" role="status">
              <span className={`punto ${online ? 'punto-ok' : 'punto-sin'}`} aria-hidden="true" />
              <span className="estado-texto">{online ? 'En línea' : 'Sin conexión'}</span>
              {cola.total > 0 && (
                <Link to="/m01/pendientes" className={`chip-pendientes${cola.rechazadas > 0 ? ' chip-rechazadas' : ''}`} data-testid="chip-pendientes">
                  <Icono nombre={cola.sincronizando ? 'enviar' : 'reloj'} tamano={16} />
                  {cola.sincronizando ? 'Enviando… ' : ''}{cola.total} {cola.total === 1 ? 'pendiente' : 'pendientes'}{cola.rechazadas > 0 ? ` (${cola.rechazadas} con problema)` : ''}
                </Link>
              )}
              {veRespaldo && <IndicadorRespaldo />}
            </div>
            <div className="interruptor" role="group" aria-label="Unidad de peso">
              <button className={unidad === 'lb' ? 'activo' : ''} onClick={() => setUnidad('lb')} aria-pressed={unidad === 'lb'}>Lb</button>
              <button className={unidad === 'kg' ? 'activo' : ''} onClick={() => setUnidad('kg')} aria-pressed={unidad === 'kg'}>Kg</button>
            </div>
          </div>
          <button ref={botonMenu} type="button" className="boton-menu" aria-label={menuAbierto ? 'Cerrar el menú' : 'Abrir el menú'}
                  aria-expanded={menuAbierto} aria-controls="menu-principal" onClick={() => setMenuAbierto((a) => !a)} data-testid="boton-menu">
            <Icono nombre={menuAbierto ? 'cerrar' : 'menu'} tamano={26} />
          </button>
        </header>

        <div className={`menu-fondo${menuAbierto ? ' abierto' : ''}`} onClick={() => setMenuAbierto(false)} aria-hidden="true" data-testid="menu-fondo" />
        <aside id="menu-principal" ref={panel} className={`menu${menuAbierto ? ' abierto' : ''}`} aria-label="Menú de opciones" inert={!menuAbierto}>
          <div className="menu-cabeza">
            <span className="menu-avatar" aria-hidden="true">{iniciales(nombre || 'Usuario')}</span>
            <div className="menu-usuario"><strong>{perfil?.nombre?.trim() || 'Mi cuenta'}</strong><span>{perfil?.correo}</span></div>
            <button type="button" className="menu-cerrar" aria-label="Cerrar el menú" onClick={() => setMenuAbierto(false)}><Icono nombre="cerrar" tamano={22} /></button>
          </div>
          <nav aria-label="Principal">
            <NavLink to="/" end><Icono nombre="inicio" tamano={22} />Inicio</NavLink>
            {modulos.map((m) => <NavLink key={m.modulo_id} to={m.ruta}><Icono nombre={iconoDeModulo(m.modulo_id)} tamano={22} />{m.nombre}</NavLink>)}
            {veRespaldo && <NavLink to="/admin/respaldo"><Icono nombre="nube" tamano={22} />Estado del respaldo</NavLink>}
            {esAdmin && <NavLink to="/admin/usuarios"><Icono nombre="usuarios" tamano={22} />Usuarios</NavLink>}
            {esAdmin && <NavLink to="/cuenta/clave"><Icono nombre="candado" tamano={22} />Cambiar mi contraseña</NavLink>}
          </nav>
          <div className="menu-pie">
            <button className="boton-peligro" onClick={() => void cerrarSesion()}><Icono nombre="salir" tamano={20} />Cerrar sesión</button>
          </div>
        </aside>

        <Sincronizador />
        {veRespaldo && <AvisoRespaldo />}
        {!online && <Alerta tipo="aviso">Sin conexión. Puedes registrar recepciones nuevas: se guardan en este dispositivo y se envían solas cuando vuelva la señal. Editar, anular, eliminar y ver fotos necesitan señal.</Alerta>}
        {verAviso && cola.ultimo && (
          <Alerta tipo={cola.ultimo.rechazadas > 0 ? 'aviso' : 'exito'}>
            {cola.ultimo.enviadas > 0 && <>Se {cola.ultimo.enviadas === 1 ? 'envió 1 recepción pendiente' : `enviaron ${cola.ultimo.enviadas} recepciones pendientes`}. </>}
            {cola.ultimo.rechazadas > 0 && <>{cola.ultimo.rechazadas === 1 ? '1 fue rechazada' : `${cola.ultimo.rechazadas} fueron rechazadas`}: <Link to="/m01/pendientes">revísalas aquí</Link>. </>}
            <button type="button" className="boton-enlace" onClick={() => setCerradoAviso(cola.ultimo)}>Cerrar aviso</button>
          </Alerta>
        )}
        <main className="contenido">
          <Suspense fallback={<Cargando />}><Outlet /></Suspense>
        </main>
      </div>
    </div>
    </RespaldoProvider>
  );
}
