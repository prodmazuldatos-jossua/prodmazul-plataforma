import { matrizQr } from './qr';

/** Medidas de la imagen de cada bin (pedidas: 302 × 378 px). */
export const ANCHO_IMG = 302;
export const ALTO_IMG = 378;
const ZONA_QR = 266; // el QR (sin contar el borde blanco) cabe en este cuadrado: ocupa casi todo el ancho

export interface DatosBin {
  lote: string; fecha: string; guia: string; librasPlanta: number | null; proveedor: string; especie: string;
}

/** Fecha AAAA-MM-DD a DD/MM/AAAA (sin tocar zonas horarias). */
export function fechaCorta(f: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : f;
}

export function textoLibras(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '';
  return `${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: false })} lb`;
}

/** Lo que se lee al escanear el QR: Lote, Fecha, Guía, Libras planta, Proveedor y Especie (una por línea). */
export function textoQrBin(d: DatosBin): string {
  return [
    `Lote: ${d.lote.trim()}`,
    `Fecha: ${fechaCorta(d.fecha)}`,
    `Guía: ${d.guia.trim()}`,
    `Libras planta: ${textoLibras(d.librasPlanta)}`,
    `Proveedor: ${d.proveedor.trim()}`,
    `Especie: ${d.especie.trim()}`,
  ].join('\n');
}

export interface Geometria { lado: number; modulo: number; x: number; y: number; n: number }

/** Posición del QR dentro de la imagen: módulos de tamaño entero (bordes nítidos), centrado en la parte de arriba. */
export function geometriaQr(n: number): Geometria {
  const modulo = Math.max(1, Math.floor(ZONA_QR / n));
  const lado = modulo * n;
  return { lado, modulo, n, x: Math.floor((ANCHO_IMG - lado) / 2), y: 16 + Math.floor((ZONA_QR - lado) / 2) };
}

export function nombreArchivoBin(lote: string, numBin: string): string {
  const seguro = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
  return `QR_Lote_${seguro(lote)}_Bin_${seguro(numBin)}.png`;
}

/** Dibuja la imagen en un canvas: QR grande arriba y el código de lote debajo. */
export function dibujarImagenBin(ctx: CanvasRenderingContext2D, d: DatosBin) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, ANCHO_IMG, ALTO_IMG);
  const m = matrizQr(textoQrBin(d));
  const g = geometriaQr(m.length);
  ctx.fillStyle = '#000';
  m.forEach((fila, f) => fila.forEach((osc, c) => { if (osc) ctx.fillRect(g.x + c * g.modulo, g.y + f * g.modulo, g.modulo, g.modulo); }));
  const lote = d.lote.trim().toUpperCase();
  let tam = 40;
  ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  do { ctx.font = `700 ${tam}px "Courier New", Courier, monospace`; tam -= 1; } while (ctx.measureText(lote).width > ANCHO_IMG - 24 && tam > 12);
  ctx.fillText(lote, ANCHO_IMG / 2, 350);
}

/** Genera el PNG de 302 × 378 px. Solo se llama cuando la persona presiona el botón. */
export async function generarImagenBin(d: DatosBin): Promise<Blob> {
  const lienzo = document.createElement('canvas');
  lienzo.width = ANCHO_IMG; lienzo.height = ALTO_IMG;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('Este navegador no puede generar la imagen.');
  dibujarImagenBin(ctx, d);
  return await new Promise<Blob>((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo generar la imagen.'))), 'image/png'));
}

export async function descargarImagenBin(d: DatosBin, numBin: string): Promise<string> {
  const blob = await generarImagenBin(d);
  const nombre = nombreArchivoBin(d.lote, numBin);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return nombre;
}
