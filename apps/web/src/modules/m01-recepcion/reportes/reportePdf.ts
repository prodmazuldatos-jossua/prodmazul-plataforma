import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import type { Unidad } from '../../../lib/unidades';
import { limpiarTexto } from '../pdf';
import { textoCelda, type CabeceraArchivo, type TablaReporte } from './reportes';

const ANCHO = 841.89; const ALTO = 595.28; const M = 28;
const AZUL = rgb(0, 0.467, 0.612); const GRIS = rgb(0.4, 0.4, 0.4); const NEGRO = rgb(0, 0, 0); const LINEA = rgb(0.76, 0.87, 0.91);
const FILA = 17;

function recortar(t: string, f: PDFFont, tam: number, ancho: number): string {
  let s = limpiarTexto(t);
  if (f.widthOfTextAtSize(s, tam) <= ancho) return s;
  while (s.length > 1 && f.widthOfTextAtSize(`${s}…`, tam) > ancho) s = s.slice(0, -1);
  return `${s}…`;
}

/** PDF A4 horizontal con las MISMAS tablas y totales que se ven en pantalla. Los gráficos no se incluyen. */
export async function generarPdfReporte(tablas: TablaReporte[], cab: CabeceraArchivo, u: Unidad, opciones: { logo?: Uint8Array; generadoPor?: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | undefined;
  if (opciones.logo) { try { logo = await doc.embedPng(opciones.logo); } catch { logo = undefined; } }
  const paginas: ReturnType<typeof doc.addPage>[] = [];
  let pag = doc.addPage([ANCHO, ALTO]); paginas.push(pag);
  let y = ALTO - M;

  const encabezado = () => {
    if (logo) { const h = 34; const w = (logo.width / logo.height) * h; pag.drawImage(logo, { x: M, y: ALTO - M - h, width: w, height: h }); }
    else pag.drawText('PRODMAZUL S.A.', { x: M, y: ALTO - M - 20, size: 14, font: negrita, color: AZUL });
    pag.drawText(limpiarTexto(cab.titulo), { x: M + 150, y: ALTO - M - 14, size: 15, font: negrita, color: NEGRO });
    pag.drawText(limpiarTexto(`${cab.rango}  |  ${cab.estados}  |  Peso en ${cab.unidad}`), { x: M + 150, y: ALTO - M - 30, size: 8.5, font: normal, color: GRIS });
    y = ALTO - M - 52;
  };
  encabezado();

  for (const t of tablas) {
    const n = t.columnas.length;
    const util = ANCHO - 2 * M;
    const primera = Math.min(util * 0.34, 230);
    const resto = n > 1 ? (util - primera) / (n - 1) : 0;
    const anchos = t.columnas.map((_, i) => (n === 1 ? util : i === 0 ? primera : resto));
    const xs: number[] = []; anchos.reduce((x, a) => { xs.push(x); return x + a; }, M);
    const cabecera = () => {
      pag.drawRectangle({ x: M, y: y - FILA + 4, width: util, height: FILA, color: rgb(0.9, 0.95, 0.97) });
      t.columnas.forEach((c, i) => {
        const txt = recortar(c.titulo, negrita, 8.5, anchos[i] - 8);
        const w = negrita.widthOfTextAtSize(txt, 8.5);
        pag.drawText(txt, { x: c.tipo === 'texto' ? xs[i] + 4 : xs[i] + anchos[i] - 4 - w, y: y - 8, size: 8.5, font: negrita, color: NEGRO });
      });
      y -= FILA;
    };
    if (y < M + 80) { pag = doc.addPage([ANCHO, ALTO]); paginas.push(pag); encabezado(); }
    pag.drawText(limpiarTexto(t.titulo), { x: M, y, size: 11, font: negrita, color: AZUL }); y -= 16;
    cabecera();
    const dibujarFila = (celdas: (string | number | null)[], fuerte: boolean) => {
      if (y < M + 30) { pag = doc.addPage([ANCHO, ALTO]); paginas.push(pag); encabezado(); cabecera(); }
      const f = fuerte ? negrita : normal;
      celdas.forEach((c, i) => {
        const col = t.columnas[i];
        const txt = recortar(textoCelda(c, col.tipo, u), f, 8.5, anchos[i] - 8);
        const w = f.widthOfTextAtSize(txt, 8.5);
        pag.drawText(txt, { x: col.tipo === 'texto' ? xs[i] + 4 : xs[i] + anchos[i] - 4 - w, y: y - 8, size: 8.5, font: f, color: NEGRO });
      });
      pag.drawLine({ start: { x: M, y: y - FILA + 4 }, end: { x: M + util, y: y - FILA + 4 }, thickness: 0.4, color: LINEA });
      y -= FILA;
    };
    t.filas.forEach((f) => dibujarFila(f, false));
    if (t.totales) dibujarFila(t.totales, true);
    if (t.nota) {
      if (y < M + 30) { pag = doc.addPage([ANCHO, ALTO]); paginas.push(pag); encabezado(); }
      pag.drawText(recortar(t.nota, normal, 7.5, ANCHO - 2 * M), { x: M, y: y - 6, size: 7.5, font: normal, color: GRIS }); y -= 14;
    }
    y -= 14;
  }
  paginas.forEach((p, i) => {
    p.drawText(limpiarTexto(`Generado ${cab.generado}${opciones.generadoPor ? ` por ${opciones.generadoPor}` : ''}  |  Pagina ${i + 1} de ${paginas.length}`), { x: M, y: 14, size: 7.5, font: normal, color: GRIS });
  });
  return doc.save();
}
