import { useCallback, useEffect, useState } from 'react';
import { Alerta, Cargando, Modal, Vacio } from '../ui';
import { Icono } from '../iconos';
import { mensajeDe } from '../../lib/errores';
import { formatoFechaHora } from '../../lib/fechas';
import { listarLotes, reabrirLote, type EstadoLotes, type ListaLotes, type LoteAdmin } from './api';
import { MOTIVO_MAXIMO, errorMotivo, textoRango, totalPaginas } from './administracion';

const ESTADOS: { id: EstadoLotes; texto: string }[] = [{ id: 'cerrados', texto: 'Cerrados' }, { id: 'abiertos', texto: 'Abiertos' }, { id: 'todos', texto: 'Todos' }];
const fmtLb = (n: number) => Number(n).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function VentanaReabrir({ lote, onCerrar, onListo }: { lote: LoteAdmin; onCerrar: () => void; onListo: (l: string) => void }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const enviar = async () => {
    const e = errorMotivo(motivo);
    if (e) { setError(e); return; }
    setGuardando(true); setError(null);
    try { await reabrirLote(lote.lote_id, motivo.trim()); onListo(lote.lote_id); }
    catch (x) { setError(mensajeDe(x)); setGuardando(false); }
  };
  return (
    <Modal titulo={`Reabrir el lote ${lote.lote_id}`} onCerrar={() => { if (!guardando) onCerrar(); }}
           acciones={<>
             <button type="button" className="boton-secundario" disabled={guardando} onClick={onCerrar}>Cancelar</button>
             <button type="button" className="boton-primario" disabled={guardando} onClick={() => void enviar()}>{guardando ? 'Reabriendo…' : 'Reabrir lote'}</button>
           </>}>
      <p className="texto-suave">{lote.proveedor} · {lote.camiones} camión(es) · {fmtLb(lote.libras_planta)} lb planta</p>
      <p>Al reabrirlo, el lote vuelve a admitir camiones. Quedará registrado quién lo reabrió y por qué.</p>
      {error && <Alerta tipo="error">{error}</Alerta>}
      <div className="campo"><label htmlFor="r-motivo">Motivo</label>
        <textarea id="r-motivo" value={motivo} maxLength={MOTIVO_MAXIMO} onChange={(e) => setMotivo(e.target.value)} /></div>
    </Modal>
  );
}

export default function PaginaLotes() {
  const [estado, setEstado] = useState<EstadoLotes>('cerrados');
  const [texto, setTexto] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<ListaLotes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ventana, setVentana] = useState<LoteAdmin | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try { setDatos(await listarLotes({ estado, busqueda, pagina })); setError(null); }
    catch (e) { setError(mensajeDe(e)); }
    finally { setCargando(false); }
  }, [estado, busqueda, pagina]);
  useEffect(() => { void cargar(); }, [cargar]);
  // la búsqueda se aplica un instante después de escribir
  useEffect(() => { const id = setTimeout(() => { setBusqueda(texto.trim()); setPagina(1); }, 350); return () => clearTimeout(id); }, [texto]);

  const paginas = datos ? totalPaginas(datos.total, datos.por_pagina) : 1;
  return (
    <div>
      <div className="encabezado-lista"><h1>Lotes</h1></div>
      <p className="texto-suave">Un lote cerrado no admite más camiones. Aquí se puede reabrir con un motivo; queda en la auditoría.</p>
      {aviso && <Alerta tipo="exito">{aviso}</Alerta>}
      <div className="tabs" role="tablist" aria-label="Estado del lote">
        {ESTADOS.map((s) => (
          <button key={s.id} role="tab" type="button" aria-selected={s.id === estado} className={s.id === estado ? 'activo' : ''}
                  onClick={() => { setEstado(s.id); setPagina(1); }}>{s.texto}</button>
        ))}
      </div>
      <div className="campo campo-busqueda"><label htmlFor="l-busqueda">Buscar por lote o proveedor</label>
        <input id="l-busqueda" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} autoComplete="off" /></div>
      {error && <Alerta tipo="error">{error}</Alerta>}
      {cargando && !datos && <Cargando />}
      {datos && (
        <>
          <p className="texto-suave" aria-live="polite" data-testid="rango-lotes">{textoRango(datos.total, datos.pagina, datos.por_pagina)}</p>
          {datos.lotes.length === 0 ? <Vacio titulo="No hay lotes en esta lista" /> : (
            <div className="tabla-scroll">
              <table className="tabla-reporte">
                <caption className="visually-hidden">Lotes</caption>
                <thead><tr><th>Lote</th><th>Proveedor</th><th>Especie</th><th className="num">Camiones</th><th className="num">Lb planta</th><th>Cierre</th><th><span className="visually-hidden">Acciones</span></th></tr></thead>
                <tbody>
                  {datos.lotes.map((l) => (
                    <tr key={l.lote_id} data-testid="fila-lote">
                      <td><strong>{l.lote_id}</strong></td><td>{l.proveedor}</td><td>{l.especie ?? '—'}</td>
                      <td className="num">{l.camiones}</td><td className="num">{fmtLb(l.libras_planta)}</td>
                      <td>{l.cerrado ? <>Cerrado{l.cerrado_en ? ` ${formatoFechaHora(l.cerrado_en)}` : ''}{l.cerrado_por ? ` · ${l.cerrado_por}` : ''}</> : 'Abierto'}</td>
                      <td>{l.cerrado && <button type="button" className="boton-mini" onClick={() => setVentana(l)} aria-label={`Reabrir el lote ${l.lote_id}`}><Icono nombre="candado" />Reabrir</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="paginacion" role="navigation" aria-label="Páginas">
            <button type="button" className="boton-secundario" disabled={cargando || pagina <= 1} onClick={() => setPagina((p) => p - 1)}><Icono nombre="izquierda" />Anterior</button>
            <span>Página {datos.pagina} de {paginas}</span>
            <button type="button" className="boton-secundario" disabled={cargando || pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente<Icono nombre="derecha" /></button>
          </div>
        </>
      )}
      {ventana && <VentanaReabrir lote={ventana} onCerrar={() => setVentana(null)} onListo={(l) => { setVentana(null); setAviso(`El lote ${l} se reabrió y vuelve a admitir camiones.`); void cargar(); }} />}
    </div>
  );
}
