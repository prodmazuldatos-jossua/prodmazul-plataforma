import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alerta, Cargando, Modal, Vacio } from '../ui';
import { Icono } from '../iconos';
import { mensajeDe } from '../../lib/errores';
import { formatoFecha } from '../../lib/fechas';
import { listarCatalogo, unirCatalogo, type Catalogo, type ItemCatalogo, type TipoCatalogo } from './api';
import { MOTIVO_MAXIMO, errorMotivo, gruposParecidos, textoUnion } from './administracion';

const TIPOS: { id: TipoCatalogo; texto: string }[] = [{ id: 'proveedores', texto: 'Proveedores' }, { id: 'especies', texto: 'Especies' }];

function VentanaUnir({ tipo, origen, todos, onCerrar, onListo }: { tipo: TipoCatalogo; origen: ItemCatalogo; todos: ItemCatalogo[]; onCerrar: () => void; onListo: (t: string) => void }) {
  const opciones = todos.filter((i) => i.id !== origen.id);
  const sugerido = opciones.find((i) => origen.grupo && i.grupo === origen.grupo)?.id ?? '';
  const [destino, setDestino] = useState(sugerido);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const elegido = opciones.find((i) => i.id === destino);
  const enviar = async () => {
    if (!elegido) { setError('Elige el nombre que se conserva.'); return; }
    const e = errorMotivo(motivo);
    if (e) { setError(e); return; }
    setGuardando(true); setError(null);
    try {
      const r = await unirCatalogo(tipo, origen.id, elegido.id, motivo.trim());
      onListo(`Se unió «${r.origen_nombre}» a «${r.destino_nombre}»: ${r.recepciones} recepción(es) y ${r.lotes} lote(s) pasaron al nombre conservado.`);
    } catch (x) { setError(mensajeDe(x)); setGuardando(false); }
  };
  return (
    <Modal titulo={`Unir «${origen.nombre}»`} onCerrar={() => { if (!guardando) onCerrar(); }}
           acciones={<>
             <button type="button" className="boton-secundario" disabled={guardando} onClick={onCerrar}>Cancelar</button>
             <button type="button" className="boton-peligro" disabled={guardando} onClick={() => void enviar()}>{guardando ? 'Uniendo…' : 'Unir nombres'}</button>
           </>}>
      {error && <Alerta tipo="error">{error}</Alerta>}
      <div className="campo"><label htmlFor="u-destino">Nombre que se conserva</label>
        <select id="u-destino" value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="">Elige uno…</option>
          {opciones.map((i) => <option key={i.id} value={i.id}>{i.nombre} ({i.recepciones} recepciones)</option>)}
        </select></div>
      {elegido && <Alerta tipo="aviso"><span data-testid="texto-union">{textoUnion(tipo, origen, elegido)}</span></Alerta>}
      <div className="campo"><label htmlFor="u-motivo">Motivo</label>
        <textarea id="u-motivo" value={motivo} maxLength={MOTIVO_MAXIMO} onChange={(e) => setMotivo(e.target.value)} /></div>
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
  const [origen, setOrigen] = useState<ItemCatalogo | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

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
      <p className="texto-suave">Revisa los proveedores y las especies. Si un mismo nombre quedó escrito de dos maneras, únelos: todo pasa al nombre que conserves.</p>
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
                      <td><button type="button" className="boton-mini" onClick={() => { setAviso(null); setOrigen(i); }} aria-label={`Unir ${i.nombre} a otro nombre`}><Icono nombre="lista" />Unir…</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {origen && <VentanaUnir tipo={tipo} origen={origen} todos={todos} onCerrar={() => setOrigen(null)} onListo={(t) => { setOrigen(null); setAviso(t); void cargar(); }} />}
    </div>
  );
}
