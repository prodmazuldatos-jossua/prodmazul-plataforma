import { supabase } from '../../lib/supabase';
import { ApiError, aApiError, esErrorDeRed } from '../../lib/errores';
import { confirmarFoto, eliminarFotoDb, registrarFoto } from './api';
import type { FotoRemota } from './tipos';

export const BUCKET_FOTOS = 'm01-recepcion-fotos';
/** Lado mayor de la foto comprimida, en píxeles. */
export const MAX_LADO_PX = 1600;
/** Peso máximo buscado al comprimir (500 KB). */
export const MAX_BYTES_FOTO = 500 * 1024;
/** Vigencia de los enlaces temporales de las fotos, en segundos. */
export const VIGENCIA_ENLACE_SEG = 600;

/** Tamaño de la foto reducida: el lado mayor no pasa de maxLado y nunca se agranda. */
export function dimensionesDestino(ancho: number, alto: number, maxLado: number = MAX_LADO_PX): { ancho: number; alto: number } {
  const mayor = Math.max(ancho, alto);
  if (mayor <= maxLado || mayor <= 0) return { ancho: Math.max(1, Math.round(ancho)), alto: Math.max(1, Math.round(alto)) };
  const f = maxLado / mayor;
  return { ancho: Math.max(1, Math.round(ancho * f)), alto: Math.max(1, Math.round(alto * f)) };
}

/** Pasos de compresión, del de mejor calidad al más pequeño: primero baja la calidad y luego el tamaño. */
export function pasosCompresion(): { factor: number; calidad: number }[] {
  const pasos: { factor: number; calidad: number }[] = [];
  for (const factor of [1, 0.85, 0.7, 0.55, 0.4]) for (const calidad of [0.8, 0.7, 0.6, 0.5]) pasos.push({ factor, calidad });
  return pasos;
}

/** Nombre de archivo sin ruta ni caracteres raros, con extensión .jpg (la foto se guarda comprimida como JPEG). */
export function nombreComprimido(nombre: string): string {
  const base = (nombre.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '');
  const limpio = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '').slice(0, 60);
  return `${limpio || 'foto'}.jpg`;
}

/** Cuántas fotos más caben: máximo menos las ya guardadas y las que esperan subirse. */
export function cuposLibres(max: number, guardadas: number, pendientes: number): number {
  return Math.max(0, max - guardadas - pendientes);
}

export function textoTamano(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function abrirImagen(archivo: Blob): Promise<{ fuente: CanvasImageSource; ancho: number; alto: number; cerrar: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const b = await createImageBitmap(archivo);
      return { fuente: b, ancho: b.width, alto: b.height, cerrar: () => b.close() };
    } catch { /* se prueba con la etiqueta img */ }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error('imagen'));
      i.src = url;
    });
    return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, cerrar: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const aBlob = (canvas: HTMLCanvasElement, calidad: number) =>
  new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', calidad));

/**
 * Reduce la foto en el dispositivo: lado mayor de 1.600 px y, si se puede, menos de 500 KB (JPEG).
 * Lanza un error si el archivo no es una imagen que el navegador pueda leer.
 */
export async function comprimirImagen(archivo: Blob): Promise<{ blob: Blob; ancho: number; alto: number }> {
  let img;
  try { img = await abrirImagen(archivo); } catch { throw new ApiError('E_FOTOS', 'No se pudo leer la imagen. Prueba con otra foto.'); }
  try {
    const base = dimensionesDestino(img.ancho, img.alto);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ApiError('E_FOTOS', 'Tu navegador no puede preparar la foto.');
    let ultimo: { blob: Blob; ancho: number; alto: number } | null = null;
    let factorDibujado = -1;
    for (const paso of pasosCompresion()) {
      if (paso.factor !== factorDibujado) {
        factorDibujado = paso.factor;
        canvas.width = Math.max(1, Math.round(base.ancho * paso.factor));
        canvas.height = Math.max(1, Math.round(base.alto * paso.factor));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img.fuente, 0, 0, canvas.width, canvas.height);
      }
      const blob = await aBlob(canvas, paso.calidad);
      if (!blob) throw new ApiError('E_FOTOS', 'Tu navegador no pudo preparar la foto.');
      ultimo = { blob, ancho: canvas.width, alto: canvas.height };
      if (blob.size <= MAX_BYTES_FOTO) break;
    }
    return ultimo as { blob: Blob; ancho: number; alto: number };
  } finally {
    img.cerrar();
  }
}

/** Traduce un error del almacenamiento a un mensaje claro. */
function errorAlmacenamiento(e: unknown, accion: 'subir' | 'borrar'): ApiError {
  if (esErrorDeRed(e)) return new ApiError('E_RED', 'No hay conexión con el servidor.');
  const x = e as { statusCode?: string | number; status?: number; message?: string };
  const codigo = Number(x?.statusCode ?? x?.status ?? 0);
  if (codigo === 401 || codigo === 403) return new ApiError('E_PERMISO', accion === 'subir' ? 'No tienes permiso para subir esta foto.' : 'No tienes permiso para borrar esta foto.');
  if (codigo === 413) return new ApiError('E_FOTOS', 'La foto es demasiado grande.');
  return new ApiError('E_FOTOS', accion === 'subir' ? 'El almacenamiento no aceptó la foto. Inténtalo de nuevo.' : 'No se pudo borrar la foto. Inténtalo de nuevo.');
}

/** Sube una foto: la registra, sube el archivo y la confirma. Si algo falla, intenta dejar todo limpio. */
export async function subirFoto(recepcionId: string, f: { blob: Blob; nombre: string; tipo: string }): Promise<void> {
  const reg = await registrarFoto(recepcionId, f.nombre, f.tipo, f.blob.size);
  const limpiar = async () => {
    try { await supabase.storage.from(BUCKET_FOTOS).remove([reg.ruta]); } catch { /* sin conexión: el registro vence solo en 1 hora */ }
    try { await eliminarFotoDb(reg.foto_id); } catch { /* idem */ }
  };
  let errorSubida: unknown = null;
  try {
    const { error } = await supabase.storage.from(BUCKET_FOTOS).upload(reg.ruta, f.blob, { contentType: f.tipo, upsert: false, cacheControl: '3600' });
    errorSubida = error;
  } catch (e) {
    errorSubida = e; // por ejemplo, la conexión se cortó a mitad de la subida
  }
  if (errorSubida) { await limpiar(); throw errorAlmacenamiento(errorSubida, 'subir'); }
  try {
    await confirmarFoto(reg.foto_id);
  } catch (e) {
    await limpiar();
    throw aApiError(e);
  }
}

/** Borra una foto guardada: primero el archivo y luego su registro (así se libera el cupo). */
export async function borrarFoto(foto: Pick<FotoRemota, 'foto_id' | 'ruta'>): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET_FOTOS).remove([foto.ruta]);
  if (error) throw errorAlmacenamiento(error, 'borrar');
  await eliminarFotoDb(foto.foto_id);
}

/** Enlaces temporales (vencen en VIGENCIA_ENLACE_SEG segundos) para ver las fotos. Clave: la ruta. */
export async function enlacesTemporales(rutas: string[]): Promise<Record<string, string>> {
  if (rutas.length === 0) return {};
  const { data, error } = await supabase.storage.from(BUCKET_FOTOS).createSignedUrls(rutas, VIGENCIA_ENLACE_SEG);
  if (error) throw errorAlmacenamiento(error, 'subir');
  const r: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) r[d.path] = d.signedUrl;
  return r;
}
