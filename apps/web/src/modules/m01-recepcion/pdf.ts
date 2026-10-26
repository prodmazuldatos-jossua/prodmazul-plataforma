import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { formatoFecha, formatoFechaHora, formatoHora } from '../../lib/fechas';
import { textoCantidad } from '../../lib/texto';
import { FACTOR_LB_KG, type Unidad } from '../../lib/unidades';
import { pesoPromedio, totalLibrasAprox } from './calculos';
import type { RecepcionDetalle } from './tipos';

// ---- Datos fijos del formulario original -------------------------------------------------------------------
export const PDF_CODIGO = 'PROM-M-P-P5-F1-C';
export const PDF_VERSION = '01';
export const PDF_FECHA_EMISION = '22-02-2026';
export const PDF_DEPARTAMENTO = 'DEPARTAMENTO DE PRODUCCION';
export const PDF_TITULO = 'CONTROL DE PESOS EN RECEPCION PESCA CRUSTACEOS';
export const PDF_DIRECCION = 'PRODMAZUL S.A  Km 3 1/2 via a la refineria del pacifico info@prodmazul.com Montecristi-Manabí-Ecuador';

/** Filas de almacenamiento y de temperatura que caben en la primera hoja (como en el formulario en papel). */
export const FILAS_BINES_HOJA = 10;
export const FILAS_TEMPERATURA_HOJA = 10;

const ANCHO = 841.89; // A4 horizontal, en puntos
const ALTO = 595.28;
const MARGEN = 28;
const NEGRO = rgb(0, 0, 0);
const GRIS = rgb(0.4, 0.4, 0.4);

export interface OpcionesPdf {
  unidad: Unidad;
  /** Bytes del logotipo (PNG). Si falta, se escribe el nombre de la empresa. */
  logo?: Uint8Array;
  /** Nombre de quien genera el PDF (aparece en el pie). */
  generadoPor?: string;
  ahora?: Date;
}

// ---- Funciones puras (se prueban sin dibujar nada) ---------------------------------------------------------

/** Deja solo caracteres que las letras estándar del PDF saben dibujar (Latin-1 y unos pocos signos más). */
export function limpiarTexto(t: string | null | undefined): string {
  if (!t) return '';
  const permitidos = new Set([0x20ac, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2026]);
  let s = '';
  for (const ch of t.replace(/[\r\n\t]+/g, ' ')) {
    const c = ch.codePointAt(0)!;
    s += (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || permitidos.has(c) ? ch : '?';
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Nombre del archivo: Recepcion_REC-AAAAMMDD-NNNN_lote-XXX-XXX-XXX.pdf (solo letras, números y guiones). */
export function nombreArchivoPdf(r: Pick<RecepcionDetalle, 'recepcion_id' | 'lote_id'>): string {
  const seguro = (t: string) => t.replace(/[^A-Za-z0-9-]/g, '-');
  return `Recepcion_${seguro(r.recepcion_id)}_lote-${seguro(r.lote_id)}.pdf`;
}

const numero = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Peso guardado en libras, en la unidad pedida y con 2 decimales («1,234.50»), igual que en pantalla. */
export function pesoTexto(lb: number | null | undefined, unidad: Unidad): string {
  if (lb === null || lb === undefined) return '';
  return numero.format(unidad === 'kg' ? lb / FACTOR_LB_KG : lb);
}

export function temperaturaTexto(c: number): string {
  return String(Math.round(c * 100) / 100);
}

/** Promedio (en libras) de las gavetas de un bloque de 10; null si no hay ninguna. */
export function promedioDeBloque(gavetas: { num_gaveta: number; peso_lb: number }[], bloque: number): number | null {
  const desde = bloque * 10 + 1;
  return pesoPromedio(gavetas.filter((g) => g.num_gaveta >= desde && g.num_gaveta < desde + 10).map((g) => g.peso_lb));
}

/** Cuántas hojas ocupa la recepción: 1 si cabe como en el papel; más si hay muchos bines o temperaturas. */
export function hojasNecesarias(nBines: number, nTemperaturas: number, lineasObservacion: number): number {
  const sobraBines = Math.max(0, nBines - FILAS_BINES_HOJA);
  const sobraTemp = Math.max(0, nTemperaturas - FILAS_TEMPERATURA_HOJA);
  if (sobraBines === 0 && sobraTemp === 0 && lineasObservacion <= 6) return 1;
  const porHoja = 28;
  const filas = sobraBines + (sobraTemp > 0 ? Math.ceil(sobraTemp / 3) + 3 : 0);
  return 1 + Math.max(1, Math.ceil(filas / porHoja));
}

export function envolver(texto: string, fuente: { widthOfTextAtSize: (t: string, s: number) => number }, tam: number, ancho: number): string[] {
  const palabras = limpiarTexto(texto).split(' ').filter(Boolean);
  const lineas: string[] = [];
  let actual = '';
  for (const p of palabras) {
    let intento = actual ? `${actual} ${p}` : p;
    if (fuente.widthOfTextAtSize(intento, tam) <= ancho) { actual = intento; continue; }
    if (actual) lineas.push(actual);
    // Una palabra más ancha que la línea se parte.
    intento = p;
    while (fuente.widthOfTextAtSize(intento, tam) > ancho && intento.length > 1) {
      let corte = intento.length - 1;
      while (corte > 1 && fuente.widthOfTextAtSize(intento.slice(0, corte), tam) > ancho) corte--;
      lineas.push(intento.slice(0, corte));
      intento = intento.slice(corte);
    }
    actual = intento;
  }
  if (actual) lineas.push(actual);
  return lineas;
}

// ---- Dibujo -------------------------------------------------------------------------------------------------

type Color = ReturnType<typeof rgb>;
interface Ctx { doc: PDFDocument; normal: PDFFont; negrita: PDFFont; logo: PDFImage | null; r: RecepcionDetalle; op: OpcionesPdf }
type Alin = 'izq' | 'centro' | 'der';

const Y = (top: number) => ALTO - top; // las posiciones se miden desde arriba de la hoja

function caja(p: PDFPage, x: number, top: number, w: number, h: number, grosor = 0.6) {
  p.drawRectangle({ x, y: Y(top + h), width: w, height: h, borderColor: NEGRO, borderWidth: grosor });
}
function linea(p: PDFPage, x1: number, t1: number, x2: number, t2: number, grosor = 0.6, color: Color = NEGRO) {
  p.drawLine({ start: { x: x1, y: Y(t1) }, end: { x: x2, y: Y(t2) }, thickness: grosor, color });
}

/** Escribe texto; si hay ancho y no cabe, reduce la letra hasta 5.5 pt y, si aún no cabe, lo recorta con «…». */
function escribir(p: PDFPage, t: string, x: number, base: number, f: PDFFont, tam: number, o: { ancho?: number; alin?: Alin; color?: Color } = {}) {
  let s = limpiarTexto(t);
  if (!s) return;
  let tamano = tam;
  if (o.ancho) {
    while (f.widthOfTextAtSize(s, tamano) > o.ancho && tamano > 5.5) tamano -= 0.25;
    while (f.widthOfTextAtSize(s, tamano) > o.ancho && s.length > 2) s = s.slice(0, -2) + '…';
  }
  const w = f.widthOfTextAtSize(s, tamano);
  const px = o.ancho && o.alin === 'centro' ? x + (o.ancho - w) / 2 : o.ancho && o.alin === 'der' ? x + o.ancho - w : x;
  p.drawText(s, { x: px, y: Y(base), size: tamano, font: f, color: o.color ?? NEGRO });
}

function celda(c: Ctx, p: PDFPage, t: string, x: number, top: number, w: number, h: number, o: { neg?: boolean; tam?: number; alin?: Alin; fondo?: boolean } = {}) {
  if (o.fondo) p.drawRectangle({ x, y: Y(top + h), width: w, height: h, color: rgb(0.9, 0.9, 0.9) });
  caja(p, x, top, w, h, 0.5);
  const tam = o.tam ?? 7.5;
  escribir(p, t, x + 3, top + h / 2 + tam * 0.35, o.neg ? c.negrita : c.normal, tam, { ancho: w - 6, alin: o.alin ?? 'centro' });
}

function encabezado(c: Ctx, p: PDFPage, top: number): number {
  const x0 = MARGEN, W = ANCHO - 2 * MARGEN, h = 64, wLogo = 120, wDer = 150, wMed = W - wLogo - wDer;
  caja(p, x0, top, W, h, 0.9);
  linea(p, x0 + wLogo, top, x0 + wLogo, top + h, 0.9);
  linea(p, x0 + wLogo + wMed, top, x0 + wLogo + wMed, top + h, 0.9);
  if (c.logo) {
    const esc = Math.min((wLogo - 12) / c.logo.width, (h - 8) / c.logo.height);
    const w = c.logo.width * esc, hh = c.logo.height * esc;
    p.drawImage(c.logo, { x: x0 + (wLogo - w) / 2, y: Y(top + (h + hh) / 2), width: w, height: hh });
  } else {
    escribir(p, 'PRODMAZUL S.A', x0 + 4, top + h / 2 + 3, c.negrita, 10, { ancho: wLogo - 8, alin: 'centro' });
  }
  const xm = x0 + wLogo;
  linea(p, xm, top + 19, xm + wMed, top + 19, 0.6);
  linea(p, xm, top + 38, xm + wMed, top + 38, 0.6);
  escribir(p, PDF_DEPARTAMENTO, xm, top + 13.5, c.negrita, 10, { ancho: wMed, alin: 'centro' });
  escribir(p, PDF_TITULO, xm, top + 32.5, c.negrita, 10, { ancho: wMed, alin: 'centro' });
  const dir = envolver(PDF_DIRECCION, c.negrita, 7.5, wMed - 16).slice(0, 2);
  dir.forEach((l, i) => escribir(p, l, xm + 8, top + (dir.length > 1 ? 47 : 51) + i * 9, c.negrita, 7.5, { ancho: wMed - 16, alin: 'centro' }));
  const xd = xm + wMed;
  linea(p, xd, top + 22, xd + wDer, top + 22);
  linea(p, xd, top + 38, xd + wDer, top + 38);
  escribir(p, PDF_CODIGO, xd, top + 15, c.negrita, 8.5, { ancho: wDer, alin: 'centro' });
  escribir(p, `Version: ${PDF_VERSION}`, xd, top + 33, c.negrita, 8.5, { ancho: wDer, alin: 'centro' });
  escribir(p, 'FECHA DE EMISION', xd, top + 49, c.negrita, 7.5, { ancho: wDer, alin: 'centro' });
  escribir(p, PDF_FECHA_EMISION, xd, top + 59, c.negrita, 7.5, { ancho: wDer, alin: 'centro' });
  return top + h;
}

function encabezadoCorto(c: Ctx, p: PDFPage, top: number): number {
  const x0 = MARGEN, W = ANCHO - 2 * MARGEN, h = 30;
  caja(p, x0, top, W, h, 0.9);
  escribir(p, `${PDF_TITULO} (continuación)`, x0 + 8, top + 13, c.negrita, 10);
  escribir(p, `Recepción ${c.r.recepcion_id}  ·  Lote ${c.r.lote_id}  ·  Proveedor ${c.r.proveedor_nombre}  ·  Llegada ${formatoFecha(c.r.fecha_llegada)}`, x0 + 8, top + 25, c.normal, 8, { ancho: W - 170 });
  escribir(p, `${PDF_CODIGO}   Version: ${PDF_VERSION}`, x0, top + 19, c.negrita, 8.5, { ancho: W - 8, alin: 'der' });
  return top + h;
}

function campos(c: Ctx, p: PDFPage, top: number): number {
  const { r, op } = c;
  const kg = op.unidad === 'kg';
  const suf = kg ? ' kg' : ' lb';
  const pesos = r.gavetas.map((g) => g.peso_lb);
  const prom = pesoPromedio(pesos);
  const dif = r.libras_reportadas !== null && r.libras_planta !== null ? r.libras_planta - r.libras_reportadas : null;
  const pct = r.diferencia_pct !== null && r.diferencia_pct !== undefined ? ` (${numero.format(r.diferencia_pct)} %)` : '';
  const difTxt = dif === null ? '' : `${dif > 0 ? '+' : ''}${pesoTexto(dif, op.unidad)}${suf}${pct}`;
  const izq: [string, string][] = [
    ['Fecha de Llegada:', formatoFecha(r.fecha_llegada)],
    ['Placa del Vehículo:', r.placa_vehiculo ?? ''],
    [kg ? 'Kilos Reportados:' : 'Libras Reportadas:', r.libras_reportadas === null ? '' : pesoTexto(r.libras_reportadas, op.unidad) + suf],
    [kg ? 'Kilos planta:' : 'Libras planta:', r.libras_planta === null ? '' : pesoTexto(r.libras_planta, op.unidad) + suf],
    ['Peso Promedio:', prom === null ? '' : pesoTexto(prom, op.unidad) + suf],
    ['Especie:', r.especie_nombre],
    ['Hora de descarga:', formatoHora(r.hora_inicio_descarga)],
  ];
  const der: [string, string][] = [
    ['Proveedor:', r.proveedor_nombre],
    ['Lote:', r.lote_id],
    ['Piscina:', r.piscina ?? ''],
    ['Guía de Remisión:', r.guia_remision],
    ['N° Gavetas/Bines:', textoCantidad(r.num_gavetas_bines, r.llegada_en)],
    ['Hora de Final de descarga:', formatoHora(r.hora_fin_descarga)],
    ['Diferencia (planta - reportadas):', difTxt],
  ];
  const fila = 11.5;
  const dibujar = (items: [string, string][], xEt: number, xVal: number, xFin: number) => items.forEach(([et, val], i) => {
    const base = top + i * fila + 9;
    escribir(p, et, xEt, base, c.negrita, 8, { ancho: xVal - xEt - 4 });
    linea(p, xVal, base + 2, xFin, base + 2, 0.4, GRIS);
    escribir(p, val, xVal + 3, base, c.normal, 8.5, { ancho: xFin - xVal - 6 });
  });
  dibujar(izq, MARGEN, 150, 340);
  dibujar(der, 440, 600, ANCHO - MARGEN);
  return top + 7 * fila + 4;
}

function bloquesGavetas(c: Ctx, p: PDFPage, top: number): number {
  const { r, op } = c;
  const fila = 11, w = 195, w1 = 55;
  const porNum = new Map(r.gavetas.map((g) => [g.num_gaveta, g.peso_lb]));
  for (let b = 0; b < 3; b++) {
    const x = MARGEN + b * (w + 6);
    celda(c, p, 'N° Gavetas', x, top, w1, fila + 1, { neg: true, fondo: true, tam: 7.5 });
    celda(c, p, `Peso Gavetas (${op.unidad === 'kg' ? 'kg' : 'lb'})`, x + w1, top, w - w1, fila + 1, { neg: true, fondo: true, tam: 7.5 });
    for (let i = 0; i < 10; i++) {
      const n = b * 10 + i + 1;
      const t = top + fila + 1 + i * fila;
      celda(c, p, String(n), x, t, w1, fila, { tam: 8 });
      celda(c, p, pesoTexto(porNum.get(n), op.unidad), x + w1, t, w - w1, fila, { tam: 8, alin: 'der' });
    }
    const tp = top + fila + 1 + 10 * fila;
    const prom = promedioDeBloque(r.gavetas, b);
    celda(c, p, 'Peso promedio', x, tp, w1, fila + 1, { neg: true, tam: 6.5, fondo: true });
    celda(c, p, prom === null ? '' : pesoTexto(prom, op.unidad), x + w1, tp, w - w1, fila + 1, { neg: true, tam: 8, alin: 'der' });
  }
  // Temperaturas (a la derecha del tercer bloque, como en el papel)
  const xt = MARGEN + 3 * (w + 6) + 4, wt = ANCHO - MARGEN - xt;
  celda(c, p, 'TEMPERATURA (°C)', xt, top, wt, fila + 1, { neg: true, fondo: true });
  celda(c, p, 'N° Gaveta', xt, top + fila + 1, 60, fila, { neg: true, tam: 7 });
  celda(c, p, 'Temperatura', xt + 60, top + fila + 1, wt - 60, fila, { neg: true, tam: 7 });
  const temps = [...r.temperaturas].sort((a, b) => (a.num_gaveta ?? 0) - (b.num_gaveta ?? 0) || a.lectura_id - b.lectura_id);
  for (let i = 0; i < FILAS_TEMPERATURA_HOJA; i++) {
    const t = top + 2 * fila + 1 + i * fila;
    const l = temps[i];
    celda(c, p, l ? String(l.num_gaveta ?? "") : '', xt, t, 60, fila, { tam: 8 });
    celda(c, p, l ? temperaturaTexto(l.temperatura_c) : '', xt + 60, t, wt - 60, fila, { tam: 8 });
  }
  return top + 12 * fila + 3;
}

const COL_ALM = [70, 140, 140, 100, 150];
const ET_ALM = ['N° BINES', '#SELLOS DE RECEPCION', '#SELLOS DE ALMACENAMIENTO', 'TEMPERATURA (°C)'];

function tablaAlmacenamiento(c: Ctx, p: PDFPage, top: number, desde: number, hasta: number, conTotal: boolean, minFilas: number): number {
  const { r, op } = c;
  const w = COL_ALM.reduce((a, b) => a + b, 0), x0 = (ANCHO - w) / 2;
  const fila = 11.5;
  celda(c, p, 'Almacenamiento de Materia Prima', x0, top, w, fila + 1, { neg: true, fondo: true, tam: 8.5 });
  let t = top + fila + 1;
  const etiquetas = [...ET_ALM, op.unidad === 'kg' ? 'KILOS APROXIMADOS' : 'LIBRAS APROXIMADAS'];
  let x = x0;
  etiquetas.forEach((e, i) => { celda(c, p, e, x, t, COL_ALM[i], fila + 1, { neg: true, tam: 6.5, fondo: true }); x += COL_ALM[i]; });
  t += fila + 1;
  const filas = r.almacenamiento.slice(desde, hasta);
  const n = Math.max(filas.length, minFilas);
  for (let i = 0; i < n; i++) {
    const a = filas[i];
    const vals = a ? [String(a.num_bin), a.sellos_recepcion ?? '', a.sellos_almacenamiento ?? '', a.temperatura_c === null ? '' : temperaturaTexto(a.temperatura_c), a.libras_aprox === null ? '' : pesoTexto(a.libras_aprox, op.unidad)] : ['', '', '', '', ''];
    x = x0;
    vals.forEach((v, j) => { celda(c, p, v, x, t, COL_ALM[j], fila, { tam: 8, alin: j === 4 ? 'der' : 'centro' }); x += COL_ALM[j]; });
    t += fila;
  }
  if (conTotal) {
    const tot = r.almacenamiento.some((a) => a.libras_aprox !== null) ? pesoTexto(totalLibrasAprox(r.almacenamiento), op.unidad) : '';
    celda(c, p, 'Total aproximado', x0, t, w - COL_ALM[4], fila, { neg: true, tam: 7.5, alin: 'der' });
    celda(c, p, tot, x0 + w - COL_ALM[4], t, COL_ALM[4], fila, { neg: true, tam: 8, alin: 'der' });
    t += fila;
  }
  return t + 4;
}

function observacion(c: Ctx, p: PDFPage, top: number, lineas: string[], minLineas: number, nota?: string): number {
  const x0 = MARGEN, W = ANCHO - 2 * MARGEN, paso = 12;
  escribir(p, 'OBSERVACIÓN:', x0, top + 8, c.negrita, 8.5);
  if (nota) escribir(p, nota, x0 + 90, top + 8, c.normal, 7, { color: GRIS });
  const n = Math.max(lineas.length, minLineas);
  for (let i = 0; i < n; i++) {
    const base = top + 8 + (i + 1) * paso;
    linea(p, x0, base + 2, x0 + W, base + 2, 0.4, GRIS);
    if (lineas[i]) escribir(p, lineas[i], x0 + 2, base, c.normal, 8.5);
  }
  return top + 8 + n * paso + 8;
}

function firmas(c: Ctx, p: PDFPage, top: number) {
  const w = 250, xs = [MARGEN + 70, ANCHO - MARGEN - 70 - w];
  const ets = ['REALIZADO POR', 'REVISADO POR'];
  const nombre = [c.r.realizado_por_nombre ?? '', ''];
  xs.forEach((x, i) => {
    linea(p, x, top + 22, x + w, top + 22, 0.8);
    escribir(p, ets[i], x, top + 32, c.negrita, 8.5, { ancho: w, alin: 'centro' });
    if (nombre[i]) escribir(p, nombre[i], x, top + 42, c.normal, 8.5, { ancho: w, alin: 'centro' });
    else escribir(p, 'Nombre', x, top + 42, c.normal, 7, { ancho: w, alin: 'centro', color: GRIS });
    escribir(p, 'ID:', x, top + 56, c.normal, 8);
    linea(p, x + 14, top + 58, x + 110, top + 58, 0.4, GRIS);
    escribir(p, 'Fecha:', x + 130, top + 56, c.normal, 8);
    linea(p, x + 160, top + 58, x + w, top + 58, 0.4, GRIS);
  });
}

function marcaDeAgua(c: Ctx, p: PDFPage) {
  const e = c.r.estado;
  const txt = e === 'anulado' ? 'ANULADA' : e === 'eliminado' ? 'ELIMINADA' : e === 'borrador' ? 'BORRADOR' : '';
  if (!txt) return;
  const tam = 90, w = c.negrita.widthOfTextAtSize(txt, tam);
  p.drawText(txt, { x: ANCHO / 2 - (w / 2) * Math.cos(Math.PI / 7), y: ALTO / 2 - (w / 2) * Math.sin(Math.PI / 7) - 20, size: tam, font: c.negrita, color: rgb(0.85, 0.85, 0.85), rotate: degrees(25.7), opacity: 0.55 });
  if (e === 'anulado' && c.r.motivo_anulacion) {
    escribir(p, `Anulada${c.r.anulado_en ? ' el ' + formatoFechaHora(c.r.anulado_en).replace(/\.$/, '') : ''}. Motivo: ${c.r.motivo_anulacion}`, MARGEN, ALTO - 36, c.negrita, 7, { ancho: ANCHO - 2 * MARGEN, color: rgb(0.6, 0, 0) });
  }
}

function temperaturasExtra(c: Ctx, p: PDFPage, top: number, lecturas: RecepcionDetalle['temperaturas']): number {
  const fila = 11, colw = 150, per = Math.ceil(lecturas.length / 4) || 1;
  escribir(p, 'TEMPERATURA (°C) — continuación', MARGEN, top + 8, c.negrita, 8.5);
  let maxT = top + 12;
  for (let k = 0; k < 4; k++) {
    const x = MARGEN + k * (colw + 12), parte = lecturas.slice(k * per, (k + 1) * per);
    if (!parte.length) continue;
    celda(c, p, 'N° Gaveta', x, top + 12, 60, fila, { neg: true, tam: 7, fondo: true });
    celda(c, p, 'Temperatura', x + 60, top + 12, colw - 60, fila, { neg: true, tam: 7, fondo: true });
    parte.forEach((l, i) => {
      celda(c, p, String(l.num_gaveta ?? ""), x, top + 12 + fila * (i + 1), 60, fila, { tam: 8 });
      celda(c, p, temperaturaTexto(l.temperatura_c), x + 60, top + 12 + fila * (i + 1), colw - 60, fila, { tam: 8 });
    });
    maxT = Math.max(maxT, top + 12 + fila * (parte.length + 1));
  }
  return maxT + 6;
}

const LIMITE = ALTO - 40; // hasta aquí se dibuja contenido; debajo va el pie

export async function generarPdfRecepcion(r: RecepcionDetalle, op: OpcionesPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Recepción ${r.recepcion_id}`);
  doc.setSubject(`${PDF_CODIGO} versión ${PDF_VERSION}`);
  doc.setCreator('Prodmazul');
  doc.setProducer('Prodmazul PWA');
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (op.logo && op.logo.length > 0) {
    try { logo = await doc.embedPng(op.logo); } catch { logo = null; }
  }
  const c: Ctx = { doc, normal, negrita, logo, r, op };
  const nuevaHoja = () => doc.addPage([ANCHO, ALTO]);

  const lineasObs = envolver(r.observacion ?? '', normal, 8.5, ANCHO - 2 * MARGEN - 4);
  const MAX_OBS_1 = 3;
  const temps = [...r.temperaturas].sort((a, b) => (a.num_gaveta ?? 0) - (b.num_gaveta ?? 0) || a.lectura_id - b.lectura_id);
  const tempsExtra = temps.slice(FILAS_TEMPERATURA_HOJA);
  const binesExtra = r.almacenamiento.length > FILAS_BINES_HOJA;
  const obsLarga = lineasObs.length > MAX_OBS_1;
  const hayContinuacion = binesExtra || tempsExtra.length > 0 || obsLarga;

  // Hoja 1
  const p1 = nuevaHoja();
  let top = encabezado(c, p1, 24) + 6;
  top = campos(c, p1, top);
  top = bloquesGavetas(c, p1, top);
  top = tablaAlmacenamiento(c, p1, top, 0, FILAS_BINES_HOJA, !binesExtra, FILAS_BINES_HOJA);
  if (binesExtra || tempsExtra.length > 0) {
    const partes = [binesExtra ? `${r.almacenamiento.length - FILAS_BINES_HOJA} bines más` : '', tempsExtra.length > 0 ? `${tempsExtra.length} lecturas de temperatura` : ''].filter(Boolean).join(' y ');
    escribir(p1, `Continúa en la hoja siguiente: ${partes}.`, MARGEN, top + 6, c.normal, 7.5, { color: GRIS });
  }
  const topObs = binesExtra ? top + 8 : top;
  const topFirmas = ALTO - 40 - 62;
  if (!hayContinuacion) {
    observacion(c, p1, topObs, lineasObs, 2);
    firmas(c, p1, topFirmas);
  } else if (!binesExtra && !tempsExtra.length) {
    // Solo la observación es larga: se muestran 3 líneas aquí y el resto en la hoja siguiente.
    observacion(c, p1, topObs, lineasObs.slice(0, MAX_OBS_1), MAX_OBS_1, '(continúa en la hoja siguiente)');
  }
  marcaDeAgua(c, p1);

  // Hojas de continuación
  if (hayContinuacion) {
    let p = nuevaHoja();
    let t = encabezadoCorto(c, p, 24) + 8;
    marcaDeAgua(c, p);
    const nueva = () => { p = nuevaHoja(); t = encabezadoCorto(c, p, 24) + 8; marcaDeAgua(c, p); };
    if (binesExtra) {
      const porHoja = Math.floor((LIMITE - t - 90) / 11.5) - 4;
      let i = FILAS_BINES_HOJA;
      while (i < r.almacenamiento.length) {
        const fin = Math.min(r.almacenamiento.length, i + porHoja);
        const ultimo = fin >= r.almacenamiento.length;
        t = tablaAlmacenamiento(c, p, t, i, fin, ultimo, 0);
        i = fin;
        if (!ultimo) nueva();
      }
    }
    if (tempsExtra.length) {
      const necesario = 12 + 11 * (Math.ceil(tempsExtra.length / 4) + 1) + 10;
      if (t + necesario > LIMITE - 140) nueva();
      t = temperaturasExtra(c, p, t, tempsExtra);
    }
    const restoObs = obsLarga && !binesExtra && !tempsExtra.length ? lineasObs.slice(MAX_OBS_1) : lineasObs;
    if (binesExtra || tempsExtra.length) {
      const alto = 8 + Math.max(restoObs.length, 2) * 12 + 8;
      if (t + alto + 70 > LIMITE) nueva();
      t = observacion(c, p, t, restoObs, 2);
    } else {
      t = observacion(c, p, t, restoObs, 2, '(continuación)');
    }
    if (t + 62 > LIMITE) nueva();
    firmas(c, p, Math.max(t + 6, ALTO - 40 - 62));
  }

  // Pie de todas las hojas
  const paginas = doc.getPages();
  const ahora = op.ahora ?? new Date();
  const unidadTxt = op.unidad === 'kg' ? 'Pesos en kilogramos (kg)' : 'Pesos en libras (lb)';
  paginas.forEach((p, i) => {
    linea(p, MARGEN, ALTO - 30, ANCHO - MARGEN, ALTO - 30, 0.4, GRIS);
    const izq = `Recepción ${r.recepcion_id} · v${r.version} · ${r.estado} · ${unidadTxt}` + (op.unidad === 'kg' ? ` (1 kg = ${FACTOR_LB_KG} lb)` : '');
    const der = `Generado ${formatoFechaHora(ahora.toISOString())}${op.generadoPor ? ' por ' + op.generadoPor : ''} · Página ${i + 1} de ${paginas.length}`;
    escribir(p, izq, MARGEN, ALTO - 20, normal, 7, { ancho: (ANCHO - 2 * MARGEN) * 0.5, color: GRIS });
    escribir(p, der, MARGEN + (ANCHO - 2 * MARGEN) * 0.5, ALTO - 20, normal, 7, { ancho: (ANCHO - 2 * MARGEN) * 0.5, alin: 'der', color: GRIS });
  });
  return doc.save();
}
