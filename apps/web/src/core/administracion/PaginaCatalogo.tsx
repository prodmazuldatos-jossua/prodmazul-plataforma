import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alerta, Cargando, Modal, Vacio } from '../ui';
import { mensajeDe } from '../../lib/errores';
import { formatoFecha } from '../../lib/fechas';
import { crearCatalogo, eliminarCatalogo, listarCatalogo, renombrarCatalogo, type Catalogo, type ItemCatalogo, type TipoCatalogo } from './api';
import { NOMBRE_CATALOGO_MAXIMO, errorNombreCatalogo, gruposParecidos } from './administracion';
import { parecidos } from '../../lib/texto';

const TIPOS: { id: TipoCatalogo; texto: string }[] = [{ id: 'proveedores', texto: 'Proveedores' }, { id: 'especies', texto: 'Especies' }];

function VentanaEditar({ tipo, item, existentes, onCerrar, onListo }: { tipo: TipoCatalogo; item: ItemCatalogo; existentes: string[]; onCerrar: () => void; onListo: (t: string) => void }) {
  const [nombre, setNombre] = useState(item.nombre);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const singular = tipo === 'proveedores' ? 'proveedor' : 'especie';
  const entrada = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => { entrada.current?.focus(); entrada.current?.select(); }, 0); return () => clearTimeout(t); }, []);
  const otros = existentes.filter((n) => n !== item.nombre);
  const enviar = async () => {
    if (nombre.trim() === item.nombre) { onCerrar(); return; }
    const e = errorNombreCatalogo(nombre, otros, tipo);
    if (e) { setError(e); return; }
    setGuardando(true); setError(null);
    try {
      const r = await renombrarCatalogo(tipo, item.id, nombre.trim());
      onListo(`Se cambió «${item.nombre}» por «${r.nombre}». Las recepciones ya lo muestran con el nombre nuevo.`);
    } catch (x) { setError(mensajeDe(x)); setGuardando(false); }
  };
  return (
    <Modal titulo={`Editar ${singular}`} onCerrar={() => { if (!guardando) onCerrar(); }}
           acciones={<>
             <button type="button" className="boton-secundario" disabled={guardando} onClick={onCerrar}>Cancelar</button>
             <button type="button" className="boton-primario" data-testid="guardar-nombre" disabled={guardando} onClick={() => void enviar()}>{guardando ? 'Guardando…' : 'Guardar'}</button>
           </>}>
      {error && <Alerta tipo="error">{error}</Alerta>}
      <div className="campo"><label htmlFor="e-nombre">Nombre del {singular}</label>
        <input id="e-nombre" type="text" value={nombre} maxLength={NOMBRE_CATALOGO_MAXIMO} autoComplete="off" ref={entrada}
               onChange={(e) => { setNombre(e.target.value); setError(null); }}
               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void enviar(); } }} />
        <p className="ayuda">El cambio se aplica a todas las recepciones y lotes que ya usan este nombre.</p></div>
    </Modal>
  );
}

function VentanaEliminar({ tipo, item, onCerrar, onListo }: { tipo: TipoCatalogo; item: ItemCatalogo; onCerrar: () => void; onListo: (t: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const enviar = async () => {
    setGuardando(true); setError(null);
    try {
      await eliminarCatalogo(tipo, item.id);
      onListo(`Se eliminó ${tipo === 'proveedores' ? 'el proveedor' : 'la especie'} «${item.nombre}».`);
    } catch (x) { setError(mensajeDe(x)); setGuardando(false); }
  };
  return (
    <Modal titulo={`Eliminar «${item.nombre}»`} onCerrar={() => { if (!guardando) onCerrar(); }}
           acciones={<>
             <button type="button" className="boton-secundario" disabled={guardando} onClick={onCerrar}>Cancelar</button>
             <button type="button" className="boton-peligro" data-testid="confirmar-eliminar" disabled={guardando} onClick={() => void enviar()}>{guardando ? 'Eliminando…' : 'Eliminar'}</button>
           </>}>
      {error && <Alerta tipo="error">{error}</Alerta>}
      <p>¿Eliminar {tipo === 'proveedores' ? 'el proveedor' : 'la especie'} <strong>{item.nombre}</strong>? No está en ninguna recepción. Esta acción no se puede deshacer.</p>
    </Modal>
  );
}

function VentanaNuevo({ tipo, existentes, onCerrar, onListo }: { tipo: TipoCatalogo; existentes: string[]; onCerrar: () => void; onListo: (t: string) => void }) {
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const singular = tipo === 'proveedores' ? 'proveedor' : 'especie';
  const entrada = useRef<HTMLInputElement>(null);
  // La ventana toma el foco al abrirse; después se lo pasamos al cuadro del nombre para poder escribir de inmediato.
  useEffect(() => { const t = setTimeout(() => entrada.current?.focus(), 0); return () => clearTimeout(t); }, []);
  const parecidosA = nombre.trim().length >= 3 ? parecidos(nombre.trim(), existentes).slice(0, 3) : [];
  const enviar = async () => {
    const e = errorNombreCatalogo(nombre, existentes, tipo);
    if (e) { setError(e); return; }
    setGuardando(true); setError(null);
    try {
      const r = await crearCatalogo(tipo, nombre.trim());
      onListo(`Se creó ${tipo === 'proveedores' ? 'el proveedor' : 'la especie'} «${r.nombre}». Ya aparece en las recepciones nuevas.`);
    } catch (x) { setError(mensajeDe(x)); setGuardando(false); }
  };
  return (
    <Modal titulo={tipo === 'proveedores' ? 'Nuevo proveedor' : 'Nueva especie'} onCerrar={() => { if (!guardando) onCerrar(); }}
           acciones={<>
             <button type="button" className="boton-secundario" disabled={guardando} onClick={onCerrar}>Cancelar</button>
             <button type="button" className="boton-primario" disabled={guardando} onClick={() => void enviar()}>{guardando ? 'Guardando…' : 'Crear'}</button>
           </>}>
      {error && <Alerta tipo="error">{error}</Alerta>}
      <div className="campo"><label htmlFor="n-nombre">Nombre del {singular}</label>
        <input id="n-nombre" type="text" value={nombre} maxLength={NOMBRE_CATALOGO_MAXIMO} autoComplete="off" ref={entrada}
               onChange={(e) => { setNombre(e.target.value); setError(null); }}
               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void enviar(); } }} />
        <p className="ayuda">Escríbelo como quieres que aparezca en las recepciones.</p></div>
      {parecidosA.length > 0 && (
        <Alerta tipo="aviso"><span data-testid="aviso-parecidos">Hay nombres parecidos: {parecidosA.map((n) => `«${n}»`).join(', ')}. Si es el mismo, no lo crees: úsalo en la recepción.</span></Alerta>
      )}
    </Modal>
  );
}

export default function PaginaCatalogo() {
  const [tipo, setTipo] = useState<TipoCatalogo>('proveedores');
  const [texto, setTexto] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [solo, setSolo] = useState(false);
  const [datos, setDatos] = useState<Catalogo | null>(null);
  const [todos, setTodos] = useState<ItemCatalogo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<ItemCatalogo | null>(null);
  const [eliminando, setEliminando] = useState<ItemCatalogo | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [d, t] = await Promise.all([
        listarCatalogo({ tipo, busqueda, solo_parecidos: solo }),
        busqueda || solo ? listarCatalogo({ tipo, busqueda: '', solo_parecidos: false }) : null,
      ]);
      setDatos(d); setTodos((t ?? d).items); setError(null);
    } catch (e) { setError(mensajeDe(e)); }
    finally { setCargando(false); }
  }, [tipo, busqueda, solo]);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { const id = setTimeout(() => setBusqueda(texto.trim()), 350); return () => clearTimeout(id); }, [texto]);

  const grupos = useMemo(() => gruposParecidos(datos?.items ?? []), [datos]);
  return (
    <div>
      <div className="encabezado-lista"><h1>Catálogo</h1></div>
      <p className="texto-suave">Crea, corrige el nombre o elimina proveedores y especies. Solo se puede eliminar lo que no está en ninguna recepción.</p>
      <div className="acciones-fila">
        <button type="button" className="boton-primario" data-testid="boton-nuevo-catalogo" onClick={() => { setAviso(null); setCreando(true); }}>
          + {tipo === 'proveedores' ? 'Nuevo proveedor' : 'Nueva especie'}
        </button>
      </div>
      {aviso && <Alerta tipo="exito">{aviso}</Alerta>}
      <div className="tabs" role="tablist" aria-label="Catálogo">
        {TIPOS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={t.id === tipo} className={t.id === tipo ? 'activo' : ''}
                  onClick={() => { setTipo(t.id); setTexto(''); setBusqueda(''); setSolo(false); setAviso(null); }}>{t.texto}</button>
        ))}
      </div>
      <div className="filtros-lista">
        <div className="campo campo-busqueda"><label htmlFor="c-busqueda">Buscar por nombre</label>
          <input id="c-busqueda" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} autoComplete="off" /></div>
        <label className="opcion-radio" htmlFor="c-solo">
          <input id="c-solo" type="checkbox" checked={solo} onChange={(e) => setSolo(e.target.checked)} />Mostrar solo nombres parecidos
        </label>
      </div>
      {error && <Alerta tipo="error">{error}</Alerta>}
      {cargando && !datos && <Cargando />}
      {datos && (
        <>
          <p className="texto-suave" aria-live="polite" data-testid="resumen-catalogo">
            {datos.items.length} de {datos.total} · {grupos.length === 0 ? 'sin nombres parecidos' : `${grupos.length} grupo(s) de nombres parecidos`}
          </p>
          {datos.items.length === 0 ? <Vacio titulo="No hay nombres en esta lista" /> : (
            <div className="tabla-scroll">
              <table className="tabla-reporte">
                <caption className="visually-hidden">{tipo === 'proveedores' ? 'Proveedores' : 'Especies'}</caption>
                <thead><tr><th>Nombre</th><th className="num">Recepciones</th><th className="num">Lotes</th><th>Última recepción</th><th><span className="visually-hidden">Acciones</span></th></tr></thead>
                <tbody>
                  {datos.items.map((i) => (
                    <tr key={i.id} data-testid="fila-catalogo" className={i.grupo ? 'fila-parecida' : undefined}>
                      <td><strong>{i.nombre}</strong>{i.grupo && <span className="etiqueta-parecido">Parecido</span>}{!i.activo && <span className="texto-suave"> · inactivo</span>}</td>
                      <td className="num">{i.recepciones}</td><td className="num">{i.lotes}</td>
                      <td>{i.ultima_recepcion ? formatoFecha(i.ultima_recepcion) : '—'}</td>
                      <td className="acciones-celda">
                        <button type="button" className="boton-secundario boton-mini" data-testid="editar-catalogo" onClick={() => { setAviso(null); setEditando(i); }} aria-label={`Editar el nombre de ${i.nombre}`}>Editar</button>{' '}
                        <button type="button" className="boton-peligro boton-mini" data-testid="eliminar-catalogo" disabled={Boolean(i.en_uso)}
                                title={i.en_uso ? 'No se puede eliminar: está en una o más recepciones.' : undefined}
                                onClick={() => { setAviso(null); setEliminando(i); }} aria-label={i.en_uso ? `${i.nombre} está en recepciones y no se puede eliminar` : `Eliminar ${i.nombre}`}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {creando && <VentanaNuevo tipo={tipo} existentes={todos.map((i) => i.nombre)} onCerrar={() => setCreando(false)} onListo={(t) => { setCreando(false); setAviso(t); setTexto(''); setBusqueda(''); setSolo(false); void cargar(); }} />}
      {editando && <VentanaEditar tipo={tipo} item={editando} existentes={todos.map((i) => i.nombre)} onCerrar={() => setEditando(null)} onListo={(t) => { setEditando(null); setAviso(t); void cargar(); }} />}
      {eliminando && <VentanaEliminar tipo={tipo} item={eliminando} onCerrar={() => setEliminando(null)} onListo={(t) => { setEliminando(null); setAviso(t); void cargar(); }} />}
    </div>
  );
}
