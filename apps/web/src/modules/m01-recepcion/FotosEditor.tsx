import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Alerta } from '../../core/ui';
import GaleriaFotos from './GaleriaFotos';
import { comprimirImagen, cuposLibres, nombreComprimido, textoTamano } from './fotos';
import type { FotoNueva } from './tipos';

interface Props {
  /** Número de la recepción si ya existe (al editar, o después de guardar un borrador). */
  recepcionId?: string;
  pendientes: FotoNueva[];
  setPendientes: Dispatch<SetStateAction<FotoNueva[]>>;
  /** Máximo de fotos por recepción. */
  max: number;
  /** Cambia para volver a pedir las fotos guardadas. */
  refrescar: number;
  /** false si el rol no puede cargar fotos. */
  puedeAgregar: boolean;
}

/**
 * Fotos de la recepción: tomar con la cámara o elegir de la galería. Se comprimen en el dispositivo y se
 * suben al guardar la recepción. Las ya guardadas se ven con enlaces temporales y se pueden quitar.
 */
export default function FotosEditor({ recepcionId, pendientes, setPendientes, max, refrescar, puedeAgregar }: Props) {
  const [guardadas, setGuardadas] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const libres = cuposLibres(max, guardadas, pendientes.length);
  const onCantidad = useCallback((n: number) => setGuardadas(n), []);

  const agregar = async (archivos: FileList | null) => {
    if (!archivos || archivos.length === 0) return;
    const lista = Array.from(archivos);
    setAviso(null);
    if (libres <= 0) { setAviso(`Ya tienes ${max} fotos: es el máximo por recepción.`); return; }
    const aceptadas = lista.slice(0, libres);
    if (lista.length > libres) setAviso(`Solo cabían ${libres} foto${libres === 1 ? '' : 's'} más (máximo ${max} por recepción). Las demás no se agregaron.`);
    for (const archivo of aceptadas) {
      if (!archivo.type.startsWith('image/')) { setAviso(`«${archivo.name}» no es una imagen y no se agregó.`); continue; }
      const id = crypto.randomUUID();
      const nombre = nombreComprimido(archivo.name);
      setPendientes((p) => [...p, { id, nombre, tipo: 'image/jpeg', tamano: archivo.size, previewUrl: '', estado: 'comprimiendo' }]);
      try {
        const r = await comprimirImagen(archivo);
        const previewUrl = URL.createObjectURL(r.blob);
        setPendientes((p) => p.map((x) => (x.id === id ? { ...x, blob: r.blob, tamano: r.blob.size, previewUrl, estado: 'lista' } : x)));
      } catch (e) {
        setPendientes((p) => p.filter((x) => x.id !== id));
        setAviso((e as Error).message || 'No se pudo leer la imagen.');
      }
    }
  };

  const quitar = (id: string) => setPendientes((p) => {
    const f = p.find((x) => x.id === id);
    if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
    return p.filter((x) => x.id !== id);
  });

  return (
    <div className="grupo-fotos" data-testid="fotos-editor">
      <p className="etiqueta-falsa"><strong>Fotos de la recepción</strong> <span className="texto-suave">({guardadas + pendientes.length} de {max})</span></p>
      {recepcionId && <GaleriaFotos recepcionId={recepcionId} puedeBorrar={puedeAgregar} refrescar={refrescar} onCantidad={onCantidad} />}

      {pendientes.length > 0 && (
        <ul className="fotos-rejilla" data-testid="fotos-pendientes">
          {pendientes.map((f) => (
            <li key={f.id} className={`foto-item foto-${f.estado}`} data-testid="foto-pendiente">
              <div className="foto-miniatura">
                {f.previewUrl ? <img src={f.previewUrl} alt={`Vista previa de ${f.nombre}`} /> : <span className="texto-suave">Preparando…</span>}
              </div>
              <p className="foto-pie">
                {f.estado === 'comprimiendo' && 'Preparando la foto…'}
                {f.estado === 'lista' && `Se subirá al guardar · ${textoTamano(f.tamano)}`}
                {f.estado === 'subiendo' && 'Subiendo…'}
                {f.estado === 'error' && <span className="error-campo" role="alert">No se subió: {f.error}</span>}
              </p>
              {(f.estado === 'lista' || f.estado === 'error') && (
                <button type="button" className="boton-secundario boton-mini" onClick={() => quitar(f.id)}>Quitar</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {aviso && <Alerta tipo="aviso">{aviso}</Alerta>}

      {puedeAgregar ? (
        <>
          <div className="acciones-fila">
            <button type="button" className="boton-secundario" disabled={libres <= 0} onClick={() => camara.current?.click()}>Tomar foto</button>
            <button type="button" className="boton-secundario" disabled={libres <= 0} onClick={() => galeria.current?.click()}>Elegir de la galería</button>
          </div>
          <input ref={camara} type="file" accept="image/*" capture="environment" hidden data-testid="entrada-camara"
                 onChange={(e) => { void agregar(e.target.files); e.target.value = ''; }} />
          <input ref={galeria} type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple hidden data-testid="entrada-galeria"
                 onChange={(e) => { void agregar(e.target.files); e.target.value = ''; }} />
          <p className="ayuda">
            {libres > 0 ? `Caben ${libres} foto${libres === 1 ? '' : 's'} más. ` : `Llegaste al máximo de ${max} fotos. `}
            Se reducen en este dispositivo (máximo 1.600 px y cerca de 500 KB) y se suben al guardar la recepción.
          </p>
        </>
      ) : (
        <p className="ayuda">Tu rol no permite cargar fotos.</p>
      )}
    </div>
  );
}
