import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Alerta, Cargando, Modal, Vacio } from '../../core/ui';
import { useAuth } from '../../core/auth/AuthContext';
import { useOnline } from '../../lib/conexion';
import { formatoFecha, formatoFechaHora } from '../../lib/fechas';
import { cola } from '../../offline/pendientes';
import { usarCola } from '../../offline/usarCola';
import type { Pendiente } from '../../offline/db';

/** Recepciones guardadas en este dispositivo que todavía no llegaron al servidor. */
export default function PaginaPendientes() {
  const { perfil } = useAuth();
  const online = useOnline();
  const estado = usarCola();
  const { state } = useLocation() as { state: { aviso?: string } | null };
  const uid = perfil?.user_id ?? '';
  const [lista, setLista] = useState<Pendiente[] | null>(null);
  const [aDescartar, setADescartar] = useState<Pendiente | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try { setLista(await cola.listar(uid)); setFallo(null); }
    catch { setFallo('No se pudo leer lo guardado en este dispositivo.'); setLista([]); }
  }, [uid]);
  // Se vuelve a leer cada vez que la cola cambia (los contadores cambian con ella).
  useEffect(() => { void cargar(); }, [cargar, estado.total, estado.rechazadas, estado.sincronizando]);

  const descartar = async () => {
    if (!aDescartar) return;
    await cola.descartar(aDescartar.client_uuid);
    setADescartar(null);
  };

  if (lista === null) return <Cargando texto="Leyendo lo guardado en este dispositivo…" />;
  return (
    <>
      <p><Link to="/m01">← Recepciones</Link></p>
      <h1>Pendientes de envío</h1>
      <p className="texto-suave">
        Recepciones registradas en este dispositivo que todavía no están en el servidor. Se envían solas al volver la señal
        (y cada minuto mientras haya conexión).
      </p>
      {state?.aviso && <Alerta tipo="exito">{state.aviso}</Alerta>}
      {fallo && <Alerta tipo="error">{fallo}</Alerta>}
      {estado.deOtros > 0 && <Alerta tipo="info">Hay {estado.deOtros} {estado.deOtros === 1 ? 'recepción pendiente de otra persona' : 'recepciones pendientes de otras personas'} en este dispositivo: se enviarán cuando ellas inicien sesión.</Alerta>}

      <div className="acciones-fila">
        <button type="button" className="boton-primario" disabled={!online || estado.sincronizando || estado.enEspera === 0} onClick={() => void estado.sincronizarAhora()}>
          {estado.sincronizando ? 'Enviando…' : 'Enviar ahora'}
        </button>
        {!online && <span className="texto-suave">Sin conexión: se enviarán al volver la señal.</span>}
      </div>

      {lista.length === 0 ? (
        <Vacio titulo="No hay nada pendiente"><p>Todo lo que registraste ya está en el servidor.</p></Vacio>
      ) : (
        <ul className="lista-pendientes" data-testid="lista-pendientes">
          {lista.map((p) => (
            <li key={p.client_uuid} className="tarjeta pendiente-tarjeta" data-testid="fila-pendiente">
              <div className="pendiente-cabeza">
                <div>
                  <p className="pendiente-titulo">Guía <strong>{p.resumen.guia_remision}</strong> · Lote <strong>{p.resumen.lote_id}</strong></p>
                  <p className="texto-suave">
                    {p.resumen.proveedor || 'Proveedor del lote'} · {p.resumen.especie} · llegada {formatoFecha(p.resumen.fecha_llegada)} ·{' '}
                    {p.resumen.estado === 'cerrado' ? 'para cerrar' : 'borrador'}{p.fotos.length > 0 && <> · {p.fotos.length} {p.fotos.length === 1 ? 'foto' : 'fotos'} por subir</>}
                  </p>
                  <p className="texto-suave">Guardada en este dispositivo: {formatoFechaHora(p.creado_en)}</p>
                </div>
                {p.estado === 'rechazada'
                  ? <span className="insignia-estado estado-anulado" data-testid="estado-pendiente">Rechazada</span>
                  : <span className="insignia-estado estado-borrador" data-testid="estado-pendiente">{p.recepcion_id ? 'Faltan fotos' : 'En espera'}</span>}
              </div>
              {p.ultimo_error && <p className={p.estado === 'rechazada' ? 'error-campo' : 'texto-suave'} data-testid="motivo-pendiente">{p.ultimo_error}</p>}
              <div className="acciones-fila">
                {p.estado === 'rechazada' && !p.recepcion_id && <Link className="boton-primario enlace-boton" to={`/m01/pendientes/${p.client_uuid}`}>Corregir</Link>}
                {p.estado === 'rechazada' && p.recepcion_id && <button type="button" className="boton-secundario" onClick={() => void cola.reintentar(p.client_uuid)}>Reintentar fotos</button>}
                <button type="button" className="boton-peligro" onClick={() => setADescartar(p)}>Descartar</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {aDescartar && (
        <Modal titulo="Descartar pendiente" onCerrar={() => setADescartar(null)}
               acciones={<>
                 <button type="button" className="boton-secundario" onClick={() => setADescartar(null)}>Cancelar</button>
                 <button type="button" className="boton-peligro" onClick={() => void descartar()}>Descartar</button>
               </>}>
          <p>
            {aDescartar.recepcion_id
              ? <>La recepción <strong>{aDescartar.recepcion_id}</strong> ya está en el servidor. Se descartan solo sus <strong>{aDescartar.fotos.length}</strong> fotos que faltan por subir.</>
              : <>Se borra del dispositivo la recepción con guía <strong>{aDescartar.resumen.guia_remision}</strong> (lote {aDescartar.resumen.lote_id}) y <strong>no se enviará</strong>. Esto no se puede deshacer.</>}
          </p>
        </Modal>
      )}
    </>
  );
}
