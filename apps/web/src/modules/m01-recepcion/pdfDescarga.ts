import type { Unidad } from '../../lib/unidades';
import type { RecepcionDetalle } from './tipos';

/** Lee el logotipo (queda guardado en el dispositivo con la app, por eso funciona sin conexión). Si falla, el PDF sale sin él. */
async function leerLogo(): Promise<Uint8Array | undefined> {
  try {
    const resp = await fetch('/logo.png');
    if (!resp.ok) return undefined;
    return new Uint8Array(await resp.arrayBuffer());
  } catch {
    return undefined;
  }
}

/** Genera el PDF en este dispositivo y lo descarga. No usa internet para generarlo. */
export async function descargarPdfRecepcion(r: RecepcionDetalle, unidad: Unidad, generadoPor?: string): Promise<string> {
  const { generarPdfRecepcion, nombreArchivoPdf } = await import('./pdf');
  const bytes = await generarPdfRecepcion(r, { unidad, logo: await leerLogo(), generadoPor });
  const nombre = nombreArchivoPdf(r);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return nombre;
}
