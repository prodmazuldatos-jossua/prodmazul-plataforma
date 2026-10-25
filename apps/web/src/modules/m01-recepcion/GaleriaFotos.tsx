import { useCallback, useEffect, useState } from 'react';
import { Alerta, Cargando, Modal } from '../../core/ui';
import { mensajeDe } from '../../lib/errores';
import { fotosDeRecepcion } from './api';
import { borrarFoto, enlacesTemporales, textoTamano, VIGENCIA_ENLACE_SEG } from './fotos';
import type { FotoRemota } from './tipos';

interface Props {
  recepcionId: string;
  /** Muestra el botón para quitar fotos. */
  puedeBorrar: boolean;
  /** Cambia para pedir de nuevo la lista (por ejemplo, después de subir fotos nuevas). */
  refrescar?: number;
  /** Avisa cuántas fotos hay guardadas. */
  onCantidad?: (n: number) => void;
}

/** Fotos guardadas de una recepción: miniaturas con enlaces temporales, vista grande y borrado. */
export default function GaleriaFotos({ recepcionId, puedeBorrar, refrescar = 0, onCantidad }: Props) {
  const [fotos, setFotos] = useState<FotoRemota[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grande, setGrande] = useState<FotoRemota | null>(null);
  const [aBorrar, setABorrar] = useState<FotoRemota | null>(null);
  const [borrando, setBorrando] = useState(false);
  const [falloBorrar, setFalloBorrar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const lista = await fotosDeRecepcion(recepcionId);
      setFotos(lista);
      onCantidad?.(lista.length);
      try { setUrls(await enlacesTemporales(lista.map((f) => f.ruta))); } catch (e) { setUrls({}); setError(`No se pudieron preparar las fotos para verlas. ${mensajeDe(e)}`); }
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setCargando(false);
    }
  }, [recepcionId, onCantidad]);

  useEffect(() => { void cargar(); }, [cargar, refrescar]);

  // Los enlaces vencen: se renuevan un poco antes para que las fotos no se «rompan» con la pantalla abierta.
  useEffect(() => {
    if (fotos.length === 0) return;
    const t = setInterval(() => { void enlacesTemporales(fotos.map((f) => f.ruta)).then(setUrls).catch(() => undefined); }, (VIGENCIA_ENLACE_SEG - 60) * 1000);
    return () => clearInterval(t);
  }, [fotos]);

  const confirmarBorrado = async () => {
    if (!aBorrar) return;
    setBorrando(true); setFalloBorrar(null);
    try {
      await borrarFoto(aBorrar);
      setABorrar(null);
      setGrande(null);
      await cargar();
    } catch (e) {
      setFalloBorrar(mensajeDe(e));
    } finally {
      setBorrando(false);
    }
  };

  if (cargando) return <Cargando texto="Cargando fotos…" />;
  return (
    <div data-testid="galeria-fotos">
      {error && <Alerta tipo="error">{error} <button type="button" className="boton-enlace" onClick={() => void cargar()}>Reintentar</button></Alerta>}
      {!error && fotos.length === 0 && <p className="texto-suave" data-testid="sin-fotos">Sin fotos guardadas.</p>}
      {fotos.length > 0 && (
        <ul className="fotos-rejilla">
          {fotos.map((f) => (
            <li key={f.foto_id} className="foto-item" data-testid="foto-guardada">
              <button type="button" className="foto-miniatura" onClick={() => setGrande(f)} aria-label={`Ver la foto ${f.nn} en grande`}>
                {urls[f.ruta]
                  ? <img src={urls[f.ruta]} alt={`Foto ${f.nn}: ${f.nombre}`} loading="lazy" onError={() => void enlacesTemporales([f.ruta]).then((u) => setUrls((p) => ({ ...p, ...u }))).catch(() => undefined)} />
                  : <span className="texto-suave">Sin vista previa</span>}
              </button>
              <p className="foto-pie">Foto {f.nn} · {textoTamano(f.tamano_bytes)}</p>
              {puedeBorrar && <button type="button" className="boton-peligro boton-mini" onClick={() => { setFalloBorrar(null); setABorrar(f); }}>Quitar</button>}
            </li>
          ))}
        </ul>
      )}

      {grande && !aBorrar && (
        <Modal titulo={`Foto ${grande.nn}`} onCerrar={() => setGrande(null)}
               acciones={<>
                 {puedeBorrar && <button type="button" className="boton-peligro" onClick={() => { setFalloBorrar(null); setABorrar(grande); }}>Quitar foto</button>}
                 <button type="button" className="boton-primario" onClick={() => setGrande(null)}>Cerrar</button>
               </>}>
          {urls[grande.ruta] ? <img className="foto-grande" src={urls[grande.ruta]} alt={`Foto ${grande.nn}: ${grande.nombre}`} /> : <p className="texto-suave">Sin vista previa.</p>}
          <p className="texto-suave">{grande.nombre} · {textoTamano(grande.tamano_bytes)}</p>
        </Modal>
      )}

      {aBorrar && (
        <Modal titulo="Quitar foto" onCerrar={() => { if (!borrando) setABorrar(null); }}
               acciones={<>
                 <button type="button" className="boton-secundario" disabled={borrando} onClick={() => setABorrar(null)}>Cancelar</button>
                 <button type="button" className="boton-peligro" disabled={borrando} onClick={() => void confirmarBorrado()}>{borrando ? 'Quitando…' : 'Quitar foto'}</button>
               </>}>
          <p>¿Quitar la <strong>foto {aBorrar.nn}</strong> de esta recepción? El archivo se borra y el espacio queda libre para otra foto.</p>
          {falloBorrar && <Alerta tipo="error">{falloBorrar}</Alerta>}
        </Modal>
      )}
    </div>
  );
}
