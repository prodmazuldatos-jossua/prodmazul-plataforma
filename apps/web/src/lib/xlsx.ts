import { strToU8, zipSync } from 'fflate';

/** Escritor mínimo de libros de Excel (.xlsx): varias hojas, encabezado con estilo, fechas y números con formato. */
export type FormatoColumna = 'texto' | 'entero' | 'dec1' | 'dec2' | 'fecha' | 'fechahora' | 'hora';

export interface ColumnaXlsx { titulo: string; formato?: FormatoColumna; ancho?: number }
export interface HojaXlsx { nombre: string; columnas: ColumnaXlsx[]; filas: unknown[][] }

// Estilos (posición en cellXfs): 0 normal, 1 encabezado, y uno por formato.
const ESTILO: Record<FormatoColumna, number> = { texto: 0, entero: 2, dec1: 3, dec2: 4, fecha: 5, fechahora: 6, hora: 7 };

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // caracteres de control no permitidos en XML 1.0
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** Letra(s) de columna: 0 → A, 25 → Z, 26 → AA. */
export function letraColumna(i: number): string {
  let n = i, s = '';
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

const DIA_MS = 86_400_000;
const EPOCA_EXCEL = Date.UTC(1899, 11, 30);

/** AAAA-MM-DD → número de serie de Excel (días desde 1900). */
export function serieFecha(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - EPOCA_EXCEL) / DIA_MS);
}

/** Fecha y hora con zona (como las guarda la base) → serie de Excel en la hora de Ecuador (UTC-5, sin horario de verano). */
export function serieFechaHora(iso: string, desfaseHoras = -5): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (t + desfaseHoras * 3_600_000 - EPOCA_EXCEL) / DIA_MS;
}

/** HH:MM[:SS] → fracción de día. */
export function serieHora(texto: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(texto);
  if (!m) return null;
  return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) / 86_400;
}

function celda(ref: string, v: unknown, formato: FormatoColumna): string {
  if (v === null || v === undefined || v === '') return '';
  let num: number | null = null;
  if (formato === 'fecha') num = serieFecha(String(v));
  else if (formato === 'fechahora') num = serieFechaHora(String(v));
  else if (formato === 'hora') num = serieHora(String(v));
  else if (formato !== 'texto') { const n = typeof v === 'number' ? v : Number(v); num = Number.isFinite(n) ? n : null; }
  if (num !== null) return `<c r="${ref}" s="${ESTILO[formato]}"><v>${num}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function xmlHoja(h: HojaXlsx): string {
  const nCol = h.columnas.length;
  const ultima = `${letraColumna(nCol - 1)}${h.filas.length + 1}`;
  const cols = h.columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho ?? 16}" customWidth="1"/>`).join('');
  const encabezado = `<row r="1" ht="32" customHeight="1">${h.columnas.map((c, i) =>
    `<c r="${letraColumna(i)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${esc(c.titulo)}</t></is></c>`).join('')}</row>`;
  const filas = h.filas.map((fila, r) =>
    `<row r="${r + 2}">${h.columnas.map((c, i) => celda(`${letraColumna(i)}${r + 2}`, fila[i], c.formato ?? 'texto')).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${ultima}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${encabezado}${filas}</sheetData><autoFilter ref="A1:${ultima}"/></worksheet>`;
}

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="167" formatCode="hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF00779C"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Excel limita el nombre de hoja a 31 caracteres y prohíbe : \ / ? * [ ] */
export const nombreHoja = (t: string) => t.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);

/** Arma el archivo .xlsx (bytes) con las hojas indicadas. */
export function construirXlsx(hojas: HojaXlsx[]): Uint8Array {
  if (hojas.length === 0) throw new Error('Se necesita al menos una hoja.');
  const archivos: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${hojas.map((h, i) => `<sheet name="${esc(nombreHoja(h.nombre))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(ESTILOS),
  };
  hojas.forEach((h, i) => { archivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xmlHoja(h)); });
  return zipSync(archivos, { level: 6 });
}
