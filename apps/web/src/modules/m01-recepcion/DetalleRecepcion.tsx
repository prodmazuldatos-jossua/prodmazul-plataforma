import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthContext';
import { Alerta, Cargando, Modal, Vacio } from '../../core/ui';
import { aApiError, mensajeDe } from '../../lib/errores';
import { formatoFecha, formatoFechaHora, formatoHora } from '../../lib/fechas';
import { textoCantidad } from '../../lib/texto';
import { useUnidad } from '../../lib/unidades';
import { anularRecepcion, eliminarRecepcion, obtenerRecepcion, reactivarRecepcion } from './api';
import { pesoPromedio, redondear } from './calculos';
import GaleriaFotos from './GaleriaFotos';
import InsigniaEstado from './InsigniaEstado';
import { capacidades } from './mapeo';
import type { RecepcionDetalle } from './tipos';

type Accion = 'anular' | 'eliminar' | 'reactivar';
const MOTIVO_MIN = 5;
const MOTIVO_MAX = 500;

const TEXTOS: Record<Accion, { titulo: string; boton: string; ayuda: string }> = {
  anular: { titulo: 'Anular recepción', boton: 'Anular recepción', ayuda: 'La recepción queda anulada: no se edita y no cuenta en los reportes. Un administrador puede reactivarla.' },
  eliminar: { titulo: 'Eliminar recepción', boton: 'Eliminar recepción', ayuda: 'La recepción deja de verse en los listados normales. No se borra de la base de datos y un administrador puede reactivarla.' },
  reactivar: { titulo: 'Reactivar recepción', boton: 'Reactivar recepción', ayuda: 'La recepción vuelve al estado que tenía antes.' },
};

function Dato({ etiqueta, children, id }: { etiqueta: string; children: ReactNode; id?: string }) {
  return <div className="dato"><dt>{etiqueta}</dt><dd data-testid={id}>{children === '' || children === null ? '—' : children}</dd></div>;
}

/** Vista de solo lectura de una recepción, con las acciones que tu rol permite. */
export default function DetalleRecepcion() {
  const { id = '' } = useParams();
  const { state } = useLocation() as { state: { aviso?: string } | null };
  const { perfil, puede } = useAuth();
  const { texto: peso } = useUnidad();
  const [r, setR] = useState<RecepcionDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(state?.aviso ?? null);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [falloAccion, setFalloAccion] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try { setR(await obtenerRecepcion(id)); } catch (e) { setR(null); setError(mensajeDe(e)); } finally { setCargando(false); }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  const cerrarModal = useCallback(() => { setAccion(null); setMotivo(''); setErrorMotivo(null); setFalloAccion(null); }, []);

  if (cargando && !r) return <Cargando texto="Cargando la recepción…" />;
  if (error || !r) {
    return (
      <Vacio titulo="No se pudo abrir la recepción">
        <p>{error ?? 'La recepción no existe.'}</p>
        <div className="acciones-fila" style={{ justifyContent: 'center' }}>
          <button type="button" className="boton-secundario" onClick={() => void cargar()}>Reintentar</button>
          <Link className="boton-primario enlace-boton" to="/m01">Volver al listado</Link>
        </div>
      </Vacio>
    );
  }

  const cap = capacidades(r, perfil?.user_id, (p) => puede('M01', p));
  const pesos = r.gavetas.map((g) => Number(g.peso_lb));
  const total = redondear(pesos.reduce((s, p) => s + p, 0));
  const prom = pesoPromedio(pesos);
  const totalAprox = redondear(r.almacenamiento.reduce((s, a) => s + Number(a.libras_aprox ?? 0), 0));
  const dif = r.diferencia_lb === null ? null : Number(r.diferencia_lb);
  const signo = (n: number) => (n > 0 ? '+' : '');

  const confirmar = async () => {
    if (!accion) return;
    if (accion !== 'reactivar') {
      const m = motivo.trim();
      if (m.length < MOTIVO_MIN) { setErrorMotivo(`El motivo debe tener al menos ${MOTIVO_MIN} caracteres.`); return; }
      if (m.length > MOTIVO_MAX) { setErrorMotivo(`El motivo no puede superar los ${MOTIVO_MAX} caracteres.`); return; }
    }
    setProcesando(true); setFalloAccion(null);
    try {
      if (accion === 'anular') await anularRecepcion(r.recepcion_id, motivo.trim(), r.version);
      else if (accion === 'eliminar') await eliminarRecepcion(r.recepcion_id, motivo.trim(), r.version);
      else await reactivarRecepcion(r.recepcion_id, r.version);
      const hecho = { anular: 'La recepción quedó anulada.', eliminar: 'La recepción quedó eliminada.', reactivar: 'La recepción fue reactivada.' }[accion];
      cerrarModal();
      setAviso(hecho);
      await cargar();
    } catch (e) {
      const err = aApiError(e);
      if (err.codigo === 'E_VERSION') {
        cerrarModal();
        setAviso(null);
        await cargar();
        setError(null);
        setFalloAccion(null);
        setAviso('Otra persona modificó esta recepción mientras la veías. Se muestra la versión más reciente: revisa y repite la acción si todavía corresponde.');
      } else {
        setFalloAccion(err.codigo === 'E_RED' ? 'Sin conexión: no se hizo el cambio. Intenta de nuevo con señal.' : err.message);
      }
    } finally {
      setProcesando(false);
    }
  };

  return (
    <>
      <div className="encabezado-lista">
        <div>
          <p className="migas"><Link to="/m01">← Recepciones</Link></p>
          <h1>Recepción {r.recepcion_id} <InsigniaEstado estado={r.estado} /></h1>
        </div>
        <div className="acciones-fila acciones-detalle">
          {cap.editar && <Link className="boton-primario enlace-boton" to={`/m01/${r.recepcion_id}/editar`}>Editar</Link>}
          {cap.anular && <button type="button" className="boton-secundario" onClick={() => setAccion('anular')}>Anular</button>}
          {cap.reactivar && <button type="button" className="boton-secundario" onClick={() => setAccion('reactivar')}>Reactivar</button>}
          {cap.eliminar && <button type="button" className="boton-peligro" onClick={() => setAccion('eliminar')}>Eliminar</button>}
        </div>
      </div>

      {aviso && <Alerta tipo="exito">{aviso}</Alerta>}
      {r.estado === 'anulado' && (
        <Alerta tipo="aviso">
          <strong>Recepción anulada</strong>{r.anulado_en ? ` el ${formatoFechaHora(r.anulado_en)}` : ''}. Motivo: {r.motivo_anulacion ?? '—'}
        </Alerta>
      )}
      {r.estado === 'eliminado' && <Alerta tipo="error"><strong>Recepción eliminada</strong>{r.eliminado_en ? ` el ${formatoFechaHora(r.eliminado_en)}` : ''}. Solo la ve un administrador.</Alerta>}
      {r.estado === 'borrador' && <Alerta tipo="info">Es un borrador: puede completarse y cerrarse más tarde.</Alerta>}

      <section className="tarjeta tarjeta-ancha" aria-labelledby="d1">
        <h2 id="d1">Datos generales</h2>
        <dl className="datos">
          <Dato etiqueta="Fecha de llegada" id="d-fecha">{formatoFecha(r.fecha_llegada)}</Dato>
          <Dato etiqueta="Placa del vehículo">{r.placa_vehiculo ?? ''}</Dato>
          <Dato etiqueta="Lote" id="d-lote">{r.lote_id}{r.lote_cerrado ? ' (lote cerrado)' : ''}</Dato>
          <Dato etiqueta="Proveedor">{r.proveedor_nombre}</Dato>
          <Dato etiqueta="Especie">{r.especie_nombre}</Dato>
          <Dato etiqueta="Piscina">{r.piscina ?? ''}</Dato>
          <Dato etiqueta="Guía de remisión" id="d-guia">{r.guia_remision}</Dato>
          <Dato etiqueta="El producto llegó en" id="d-llegada">{textoCantidad(r.num_gavetas_bines, r.llegada_en)}</Dato>
          <Dato etiqueta="Libras reportadas">{r.libras_reportadas === null ? '' : peso(Number(r.libras_reportadas))}</Dato>
          <Dato etiqueta="Libras de planta">{r.libras_planta === null ? '' : peso(Number(r.libras_planta))}</Dato>
          <Dato etiqueta="Diferencia (planta − reportadas)" id="d-dif">
            {dif === null ? '' : `${signo(dif)}${peso(dif)}${r.diferencia_pct === null ? '' : ` (${signo(Number(r.diferencia_pct))}${Number(r.diferencia_pct).toFixed(2)} %)`}`}
          </Dato>
          <Dato etiqueta="Inicio de descarga">{formatoHora(r.hora_inicio_descarga)}</Dato>
          <Dato etiqueta="Fin de descarga">{formatoHora(r.hora_fin_descarga)}</Dato>
          <Dato etiqueta="Realizado por">{r.realizado_por_nombre ?? ''}</Dato>
          <Dato etiqueta="Última modificación">{formatoFechaHora(r.modificado_en)}</Dato>
        </dl>
      </section>

      <section className="tarjeta tarjeta-ancha" aria-labelledby="d2">
        <h2 id="d2">Gavetas pesadas</h2>
        {r.gavetas.length === 0 ? <p className="texto-suave">Sin gavetas pesadas.</p> : (
          <>
            <div className="tabla-scroll tabla-scroll-chica">
              <table className="tabla-lista">
                <thead><tr><th>Gaveta</th><th className="num">Peso</th></tr></thead>
                <tbody>{r.gavetas.map((g) => <tr key={g.num_gaveta}><td>{g.num_gaveta}</td><td className="num">{peso(Number(g.peso_lb))}</td></tr>)}</tbody>
              </table>
            </div>
            <p data-testid="d-resumen-gavetas"><strong>{r.gavetas.length}</strong> {r.gavetas.length === 1 ? 'gaveta pesada' : 'gavetas pesadas'} · Total: <strong>{peso(total)}</strong> · Promedio: <strong>{prom === null ? '—' : peso(prom)}</strong></p>
          </>
        )}
      </section>

      <section className="tarjeta tarjeta-ancha" aria-labelledby="d3">
        <h2 id="d3">Temperaturas del producto (°C)</h2>
        {r.temperaturas.length === 0 ? <p className="texto-suave">Sin temperaturas registradas.</p> : (
          <ul className="lista-simple">
            {r.temperaturas.map((t) => <li key={t.lectura_id}>{t.num_gaveta ? `Gaveta ${t.num_gaveta}` : `Lectura ${t.lectura_id}`}: <strong>{Number(t.temperatura_c).toFixed(1)} °C</strong></li>)}
          </ul>
        )}
      </section>

      <section className="tarjeta tarjeta-ancha" aria-labelledby="d4">
        <h2 id="d4">Almacenamiento de materia prima</h2>
        {r.almacenamiento.length === 0 ? <p className="texto-suave">Sin filas de almacenamiento.</p> : (
          <>
            <div className="tabla-scroll">
              <table className="tabla-lista">
                <thead><tr><th>Bin</th><th>Sellos recepción</th><th>Sellos almacenamiento</th><th className="num">Temp. °C</th><th className="num">Libras aprox.</th></tr></thead>
                <tbody>{r.almacenamiento.map((a) => (
                  <tr key={a.num_bin}><td>{a.num_bin}</td><td>{a.sellos_recepcion || '—'}</td><td>{a.sellos_almacenamiento || '—'}</td>
                    <td className="num">{a.temperatura_c === null ? '—' : Number(a.temperatura_c).toFixed(1)}</td>
                    <td className="num">{a.libras_aprox === null ? '—' : peso(Number(a.libras_aprox))}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <p>Total aproximado: <strong>{peso(totalAprox)}</strong></p>
          </>
        )}
      </section>

      <section className="tarjeta tarjeta-ancha" aria-labelledby="d5">
        <h2 id="d5">Observación</h2>
        <p data-testid="d-observacion">{r.observacion ?? <span className="texto-suave">Sin observación.</span>}</p>
      </section>

      <section className="tarjeta tarjeta-ancha" aria-labelledby="d6">
        <h2 id="d6">Fotos</h2>
        <GaleriaFotos recepcionId={r.recepcion_id} puedeBorrar={cap.editar && puede('M01', 'cargar_imagenes')} refrescar={r.version} />
        {cap.editar && puede('M01', 'cargar_imagenes') && <p className="ayuda">Para agregar fotos usa <strong>Editar</strong>.</p>}
      </section>

      {accion && (
        <Modal titulo={TEXTOS[accion].titulo} onCerrar={() => { if (!procesando) cerrarModal(); }}
               acciones={<>
                 <button type="button" className="boton-secundario" disabled={procesando} onClick={cerrarModal}>Cancelar</button>
                 <button type="button" className={accion === 'eliminar' || accion === 'anular' ? 'boton-peligro' : 'boton-primario'}
                         disabled={procesando} onClick={() => void confirmar()}>{procesando ? 'Procesando…' : TEXTOS[accion].boton}</button>
               </>}>
          <p>Recepción <strong>{r.recepcion_id}</strong> · lote {r.lote_id}.</p>
          <p className="ayuda">{TEXTOS[accion].ayuda}</p>
          {accion !== 'reactivar' && (
            <div className="campo">
              <label htmlFor="motivo">Motivo <span className="obligatorio" aria-hidden="true">*</span></label>
              <textarea id="motivo" rows={3} value={motivo} maxLength={MOTIVO_MAX} aria-invalid={Boolean(errorMotivo)}
                        aria-describedby={errorMotivo ? 'motivo-error' : undefined}
                        onChange={(e) => { setMotivo(e.target.value); setErrorMotivo(null); }} />
              {errorMotivo && <p className="error-campo" id="motivo-error">{errorMotivo}</p>}
            </div>
          )}
          {falloAccion && <Alerta tipo="error">{falloAccion}</Alerta>}
        </Modal>
      )}
    </>
  );
}
