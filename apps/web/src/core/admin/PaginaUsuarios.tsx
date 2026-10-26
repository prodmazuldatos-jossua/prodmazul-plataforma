import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alerta, Cargando, Modal, Vacio } from '../ui';
import { Icono } from '../iconos';
import { CLAVE_MINIMA } from '../auth/AuthContext';
import { mensajeDe } from '../../lib/errores';
import { formatoFechaHora } from '../../lib/fechas';
import { actualizarUsuario, cambiarClaveUsuario, crearUsuario, generarClave, listarUsuarios, type ListaUsuarios, type UsuarioAdmin } from './api';

type Ventana = { tipo: 'crear' } | { tipo: 'editar'; u: UsuarioAdmin } | { tipo: 'clave'; u: UsuarioAdmin } | null;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function iniciales(t: string) {
  const p = t.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return (p.length > 1 ? p[0][0] + p[1][0] : (p[0] ?? '?').slice(0, 2)).toUpperCase();
}

/** Campo de contraseña con «Ver» y «Generar». */
function CampoClave({ valor, onChange, id, etiqueta }: { valor: string; onChange: (v: string) => void; id: string; etiqueta: string }) {
  const [ver, setVer] = useState(false);
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta} <span className="unidad-etiqueta">(mínimo {CLAVE_MINIMA} caracteres)</span></label>
      <div className="campo-con-boton">
        <input id={id} type={ver ? 'text' : 'password'} autoComplete="new-password" value={valor} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="boton-secundario" onClick={() => setVer(!ver)} aria-pressed={ver}><Icono nombre={ver ? 'ojoNo' : 'ojo'} />{ver ? 'Ocultar' : 'Ver'}</button>
        <button type="button" className="boton-secundario" onClick={() => { onChange(generarClave()); setVer(true); }}><Icono nombre="clave" />Generar</button>
      </div>
    </div>
  );
}

export default function PaginaUsuarios() {
  const [datos, setDatos] = useState<ListaUsuarios | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ventana, setVentana] = useState<Ventana>(null);
  const [aviso, setAviso] = useState<{ tipo: 'exito' | 'aviso'; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try { setDatos(await listarUsuarios()); } catch (e) { setError(mensajeDe(e)); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const nombreRol = (id: string) => datos?.roles.find((r) => r.rol_id === id)?.nombre ?? id;
  const nombreModulo = (id: string) => datos?.modulos.find((m) => m.modulo_id === id)?.nombre ?? id;

  if (error) return <Vacio titulo="No se pudo cargar la lista"><p>{error}</p><button type="button" className="boton-secundario" onClick={() => void cargar()}>Reintentar</button></Vacio>;
  if (!datos) return <Cargando texto="Cargando usuarios…" />;

  return (
    <>
      <div className="encabezado-lista">
        <h1><Icono nombre="usuarios" tamano={28} />Usuarios</h1>
        <div className="acciones-fila acciones-detalle">
          <button type="button" className="boton-primario" data-testid="boton-nuevo-usuario" onClick={() => { setAviso(null); setVentana({ tipo: 'crear' }); }}><Icono nombre="mas" />Nuevo usuario</button>
        </div>
      </div>
      <p className="texto-suave">Aquí creas usuarios, les asignas su rol, los desactivas y cambias sus contraseñas. Los usuarios de módulo no pueden cambiar su propia contraseña: la define el administrador.</p>
      {aviso && <Alerta tipo={aviso.tipo}>{aviso.texto} <button type="button" className="boton-enlace" onClick={() => setAviso(null)}>Cerrar aviso</button></Alerta>}

      <ul className="lista-usuarios" aria-label="Usuarios">
        {datos.usuarios.map((u) => (
          <li key={u.user_id} className={`tarjeta tarjeta-usuario${u.activo ? '' : ' usuario-inactivo'}`} data-testid={`usuario-${u.correo}`}>
            <span className="menu-avatar usuario-avatar" aria-hidden="true">{iniciales(u.nombre || u.correo)}</span>
            <div className="usuario-datos">
              <p className="usuario-nombre">{u.nombre || <span className="texto-suave">(sin nombre)</span>}</p>
              <p className="usuario-correo">{u.correo}</p>
              <p className="usuario-etiquetas">
                {u.es_admin_general
                  ? <span className="insignia-estado estado-cerrado">Administrador general</span>
                  : u.roles.length === 0
                    ? <span className="insignia-estado estado-eliminado">Sin acceso a módulos</span>
                    : u.roles.map((r) => <span key={r.modulo_id} className="insignia-estado estado-borrador">{nombreModulo(r.modulo_id)}: {nombreRol(r.rol_id)}</span>)}
                <span className={`insignia-estado ${u.activo ? 'estado-cerrado' : 'estado-anulado'}`}>{u.activo ? 'Activo' : 'Desactivado'}</span>
              </p>
              <p className="ayuda">{u.ultimo_acceso ? `Último acceso: ${formatoFechaHora(u.ultimo_acceso)}` : 'Aún no ha iniciado sesión'}</p>
            </div>
            <div className="acciones-fila usuario-acciones">
              <button type="button" className="boton-secundario boton-mini" onClick={() => { setAviso(null); setVentana({ tipo: 'editar', u }); }}><Icono nombre="editar" tamano={18} />Editar</button>
              <button type="button" className="boton-secundario boton-mini" onClick={() => { setAviso(null); setVentana({ tipo: 'clave', u }); }}><Icono nombre="clave" tamano={18} />Contraseña</button>
            </div>
          </li>
        ))}
      </ul>

      {ventana?.tipo === 'crear' && <VentanaCrear datos={datos} onCerrar={() => setVentana(null)}
        onListo={(texto) => { setVentana(null); setAviso({ tipo: 'exito', texto }); void cargar(); }} />}
      {ventana?.tipo === 'editar' && <VentanaEditar datos={datos} u={ventana.u} onCerrar={() => setVentana(null)}
        onListo={(texto) => { setVentana(null); setAviso({ tipo: 'exito', texto }); void cargar(); }} />}
      {ventana?.tipo === 'clave' && <VentanaClave u={ventana.u} onCerrar={() => setVentana(null)}
        onListo={(texto) => { setVentana(null); setAviso({ tipo: 'exito', texto }); }} />}
    </>
  );
}

function SelectorRoles({ datos, valores, onChange, deshabilitado }: {
  datos: ListaUsuarios; valores: Record<string, string>; onChange: (m: string, r: string) => void; deshabilitado?: boolean;
}) {
  return (
    <>
      {datos.modulos.map((m) => (
        <div className="campo" key={m.modulo_id}>
          <label htmlFor={`rol-${m.modulo_id}`}>Rol en {m.nombre}</label>
          <select id={`rol-${m.modulo_id}`} value={valores[m.modulo_id] ?? ''} disabled={deshabilitado} onChange={(e) => onChange(m.modulo_id, e.target.value)}>
            <option value="">Sin acceso</option>
            {datos.roles.map((r) => <option key={r.rol_id} value={r.rol_id}>{r.nombre}</option>)}
          </select>
        </div>
      ))}
    </>
  );
}

const aLista = (v: Record<string, string>) => Object.entries(v).filter(([, r]) => r).map(([modulo_id, rol_id]) => ({ modulo_id, rol_id }));

function VentanaCrear({ datos, onCerrar, onListo }: { datos: ListaUsuarios; onCerrar: () => void; onListo: (texto: string) => void }) {
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [roles, setRoles] = useState<Record<string, string>>(() => Object.fromEntries(datos.modulos.map((m) => [m.modulo_id, 'operativo'])));
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const enviar = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!nombre.trim()) { setError('Escribe el nombre.'); return; }
    if (!CORREO.test(correo.trim())) { setError('El correo no es válido.'); return; }
    if (clave.length < CLAVE_MINIMA) { setError(`La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`); return; }
    setGuardando(true); setError('');
    try {
      await crearUsuario(correo.trim().toLowerCase(), nombre.trim(), clave, aLista(roles));
      onListo(`Usuario creado: ${correo.trim().toLowerCase()}. Contraseña temporal: ${clave} (anótala y entrégala ahora; no se vuelve a mostrar).`);
    } catch (err) { setError((err as Error).message); setGuardando(false); }
  };

  return (
    <Modal titulo="Nuevo usuario" onCerrar={() => { if (!guardando) onCerrar(); }}
           acciones={<>
             <button type="button" className="boton-secundario" disabled={guardando} onClick={onCerrar}>Cancelar</button>
             <button type="button" className="boton-primario" disabled={guardando} onClick={() => void enviar()}>{guardando ? 'Creando…' : 'Crear usuario'}</button>
           </>}>
      <form onSubmit={(e) => void enviar(e)} noValidate>
        {error && <Alerta tipo="error">{error}</Alerta>}
        <div className="campo"><label htmlFor="u-nombre">Nombre completo</label>
          <input id="u-nombre" value={nombre} maxLength={60} autoComplete="off" onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="campo"><label htmlFor="u-correo">Correo (será su usuario)</label>
          <input id="u-correo" type="email" value={correo} autoComplete="off" onChange={(e) => setCorreo(e.target.value)} /></div>
        <CampoClave id="u-clave" etiqueta="Contraseña temporal" valor={clave} onChange={setClave} />
        <SelectorRoles datos={datos} valores={roles} onChange={(m, r) => setRoles((p) => ({ ...p, [m]: r }))} />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

function VentanaEditar({ datos, u, onCerrar, onListo }: { datos: ListaUsuarios; u: UsuarioAdmin; onCerrar: () => void; onListo: (texto: string) => void }) {
  const [nombre, setNombre] = useState(u.nombre);
  const [activo, setActivo] = useState(u.activo);
  const [roles, setRoles] = useState<Record<string, string>>(() => Object.fromEntries(u.roles.map((r) => [r.modulo_id, r.rol_id])));
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const enviar = async () => {
    if (!nombre.trim()) { setError('Escribe el nombre.'); return; }
    setGuardando(true); setError('');
    try {
      const lista = u.es_admin_general ? [] : datos.modulos.map((m) => ({ modulo_id: m.modulo_id, rol_id: roles[m.modulo_id] || null }));
      await actualizarUsuario(u.user_id, nombre.trim(), activo, lista);
      onListo(`Se guardaron los cambios de ${u.correo}.`);
    } catch (err) { setError(mensajeDe(err)); setGuardando(false); }
  };

  return (
    <Modal titulo={`Editar usuario`} onCerrar={() => { if (!guardando) onCerrar(); }}
           acciones={<>
             <button type="button" className="boton-secundario" disabled={guardando} onClick={onCerrar}>Cancelar</button>
             <button type="button" className="boton-primario" disabled={guardando} onClick={() => void enviar()}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button>
           </>}>
      <p className="texto-suave">{u.correo}</p>
      {error && <Alerta tipo="error">{error}</Alerta>}
      <div className="campo"><label htmlFor="e-nombre">Nombre completo</label>
        <input id="e-nombre" value={nombre} maxLength={60} autoComplete="off" onChange={(e) => setNombre(e.target.value)} /></div>
      {u.es_admin_general
        ? <p className="ayuda">Es administrador general: tiene todos los permisos y no se puede desactivar.</p>
        : <>
            <SelectorRoles datos={datos} valores={roles} onChange={(m, r) => setRoles((p) => ({ ...p, [m]: r }))} />
            <label className="opcion-radio" htmlFor="e-activo">
              <input id="e-activo" type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
              <span>Usuario activo (si lo desactivas, ya no puede entrar)</span>
            </label>
          </>}
    </Modal>
  );
}

function VentanaClave({ u, onCerrar, onListo }: { u: UsuarioAdmin; onCerrar: () => void; onListo: (texto: string) => void }) {
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const enviar = async () => {
    if (clave.length < CLAVE_MINIMA) { setError(`La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`); return; }
    setGuardando(true); setError('');
    try {
      await cambiarClaveUsuario(u.user_id, clave);
      onListo(`Contraseña cambiada para ${u.correo}. Nueva contraseña: ${clave} (anótala y entrégala ahora; no se vuelve a mostrar).`);
    } catch (err) { setError((err as Error).message); setGuardando(false); }
  };
  return (
    <Modal titulo="Cambiar contraseña" onCerrar={() => { if (!guardando) onCerrar(); }}
           acciones={<>
             <button type="button" className="boton-secundario" disabled={guardando} onClick={onCerrar}>Cancelar</button>
             <button type="button" className="boton-primario" disabled={guardando} onClick={() => void enviar()}>{guardando ? 'Guardando…' : 'Cambiar contraseña'}</button>
           </>}>
      <p className="texto-suave">{u.nombre || u.correo} · {u.correo}</p>
      {error && <Alerta tipo="error">{error}</Alerta>}
      <CampoClave id="c-clave" etiqueta="Contraseña nueva" valor={clave} onChange={setClave} />
      <p className="ayuda">Si la persona tenía la sesión abierta, seguirá dentro hasta que la cierre; la próxima vez deberá usar la nueva.</p>
    </Modal>
  );
}
