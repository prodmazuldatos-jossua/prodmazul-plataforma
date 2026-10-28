import { matrizQr } from './qr';

/** Medidas de la imagen de cada bin (pedidas: 302 × 378 px). */
export const ANCHO_IMG = 302;
export const ALTO_IMG = 378;

export interface DatosBin { lote: string; guia: string; proveedor: string; especie: string }

/**
 * Texto sin tildes ni símbolos raros, en una sola línea y con largo máximo. Así el QR queda corto y se lee igual
 * en cualquier lector (los lectores viejos o de pistola no siempre entienden las tildes y la «ñ»).
 */
export function textoSeguroQr(t: string, max: number): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/** Lo que se lee al escanear el QR de un bin: Lote, Proveedor, Especie y Guía (una por línea). */
export function textoQrBin(d: DatosBin): string {
  return [
    `Lote: ${textoSeguroQr(d.lote, 20)}`,
    `Proveedor: ${textoSeguroQr(d.proveedor, 50)}`,
    `Especie: ${textoSeguroQr(d.especie, 30)}`,
    `Guia: ${textoSeguroQr(d.guia, 30)}`,
  ].join('\n');
}

/** Espacio libre abajo de la imagen para el código de lote. */
const ZONA_TEXTO = 56;
/** Borde blanco mínimo alrededor del QR, en módulos (la norma pide 4: sin él algunos lectores no lo encuentran). */
const BORDE_MODULOS = 4;

export interface Geometria { lado: number; modulo: number; x: number; y: number; n: number }

/**
 * Posición del QR dentro de la imagen. Los módulos miden un número entero de píxeles (bordes nítidos) y siempre
 * queda un borde blanco de 4 módulos a cada lado; dentro de eso, el QR es lo más grande posible.
 */
export function geometriaQr(n: number): Geometria {
  const modulo = Math.max(1, Math.floor(ANCHO_IMG / (n + 2 * BORDE_MODULOS)));
  const lado = modulo * n;
  const disponible = ALTO_IMG - ZONA_TEXTO;
  return { lado, modulo, n, x: Math.floor((ANCHO_IMG - lado) / 2), y: Math.max(BORDE_MODULOS * modulo, Math.floor((disponible - lado) / 2)) };
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
