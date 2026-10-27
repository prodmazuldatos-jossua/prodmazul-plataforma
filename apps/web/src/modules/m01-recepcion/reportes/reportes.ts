// Lógica pura de los reportes (sin pantalla): fechas, validación, tablas y datos de gráficos.
// UNA sola definición de cada tabla sirve para la pantalla, el CSV, el Excel y el PDF: por eso los archivos coinciden con lo que se ve.
import { FACTOR_LB_KG, type Unidad } from '../../../lib/unidades';

export type Periodo = 'dia' | 'semana' | 'mes';
export type Vista = 'libras' | 'lotes' | 'proveedores' | 'libras_proveedor' | 'especie';

export const VISTAS: { id: Vista; titulo: string; corto: string }[] = [
  { id: 'libras', titulo: 'Libras planta por periodo', corto: 'Libras' },
  { id: 'lotes', titulo: 'Lotes por periodo', corto: 'Lotes' },
  { id: 'proveedores', titulo: 'Proveedores', corto: 'Proveedores' },
  { id: 'libras_proveedor', titulo: 'Libras por proveedor', corto: 'Libras por proveedor' },
  { id: 'especie', titulo: 'Especie por proveedor', corto: 'Especie por proveedor' },
];
export const PERIODOS: { id: Periodo; texto: string; singular: string }[] = [
  { id: 'dia', texto: 'Día', singular: 'día' },
  { id: 'semana', texto: 'Semana', singular: 'semana' },
  { id: 'mes', texto: 'Mes', singular: 'mes' },
];
export const esVista = (v: string | null): v is Vista => VISTAS.some((x) => x.id === v);
export const esPeriodo = (v: string | null): v is Periodo => PERIODOS.some((x) => x.id === v);

/** Qué función de la base responde cada vista. */
export const FUENTE: Record<Vista, 'periodos' | 'proveedores' | 'especie'> = {
  libras: 'periodos', lotes: 'periodos', proveedores: 'proveedores', libras_proveedor: 'proveedores', especie: 'especie',
};

// ---- respuestas de la base ----------------------------------------------------------------------------------
export interface FilaPeriodo {
  inicio: string; fin: string; parcial: boolean; recepciones: number; lotes: number;
  libras_planta: number; libras_reportadas: number; diferencia_lb: number; diferencia_pct: number | null;
}
export interface RespPeriodos {
  desde: string; hasta: string; periodo: Periodo; borradores: boolean; filas: FilaPeriodo[];
  totales: { recepciones: number; lotes: number; libras_planta: number; libras_reportadas: number; diferencia_lb: number; diferencia_pct: number | null };
}
export interface FilaProveedor {
  proveedor_id: string; proveedor: string; recepciones: number; lotes: number;
  libras_planta: number; libras_reportadas: number; diferencia_lb: number; porcentaje: number;
}
export interface RespProveedores {
  desde: string; hasta: string; borradores: boolean; proveedores_con_recepcion: number; proveedores_catalogo: number;
  filas: FilaProveedor[]; totales: { recepciones: number; lotes: number; libras_planta: number; libras_reportadas: number };
}
export interface FilaEspecieProveedor {
  proveedor_id: string; proveedor: string; especie_id: string; especie: string; recepciones: number; lotes: number; libras_planta: number; libras_reportadas: number;
}
export interface FilaEspecie { especie_id: string; especie: string; recepciones: number; lotes: number; proveedores: number; libras_planta: number }
export interface RespEspecie {
  desde: string; hasta: string; borradores: boolean; filas: FilaEspecieProveedor[]; por_especie: FilaEspecie[];
  totales: { recepciones: number; lotes: number; proveedores: number; especies: number; libras_planta: number };
}
export type DatosReporte = RespPeriodos | RespProveedores | RespEspecie;

// ---- fechas (texto AAAA-MM-DD, sin depender de la zona horaria del dispositivo) ------------------------------
const MS_DIA = 86_400_000;
const aMs = (iso: string) => { const [a, m, d] = iso.split('-').map(Number); return Date.UTC(a, m - 1, d); };
const aIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const esFechaIso = (t: string) => /^\d{4}-\d{2}-\d{2}$/.test(t) && aIso(aMs(t)) === t;
export const sumarDias = (iso: string, n: number) => aIso(aMs(iso) + n * MS_DIA);
export const diasEntre = (desde: string, hasta: string) => Math.round((aMs(hasta) - aMs(desde)) / MS_DIA);
export const primerDiaMes = (iso: string) => `${iso.slice(0, 7)}-01`;
export const ultimoDiaMes = (iso: string) => { const [a, m] = iso.split('-').map(Number); return aIso(Date.UTC(a, m, 0)); };
/** Lunes de la semana de esa fecha (la semana empieza el lunes). */
export const lunesDe = (iso: string) => { const dia = new Date(aMs(iso)).getUTCDay(); return sumarDias(iso, -((dia + 6) % 7)); };

export type Atajo = 'hoy' | 'semana' | 'mes' | 'mes_anterior' | '30dias' | 'anio';
export const ATAJOS: { id: Atajo; texto: string }[] = [
  { id: 'hoy', texto: 'Hoy' }, { id: 'semana', texto: 'Esta semana' }, { id: 'mes', texto: 'Este mes' },
  { id: 'mes_anterior', texto: 'Mes anterior' }, { id: '30dias', texto: 'Últimos 30 días' }, { id: 'anio', texto: 'Este año' },
];
export function rangoAtajo(atajo: Atajo, hoy: string): { desde: string; hasta: string } {
  switch (atajo) {
    case 'hoy': return { desde: hoy, hasta: hoy };
    case 'semana': return { desde: lunesDe(hoy), hasta: hoy };
    case 'mes': return { desde: primerDiaMes(hoy), hasta: hoy };
    case 'mes_anterior': { const fin = sumarDias(primerDiaMes(hoy), -1); return { desde: primerDiaMes(fin), hasta: fin }; }
    case '30dias': return { desde: sumarDias(hoy, -29), hasta: hoy };
    case 'anio': return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy };
  }
}

/** Máximo de días que admite cada reporte (igual que en la base de datos). */
export const MAX_DIAS: Record<Periodo, number> = { dia: 400, semana: 1830, mes: 3660 };
const MAX_DIAS_OTROS = 3660;

export interface Filtros { desde: string; hasta: string; periodo: Periodo; borradores: boolean }

/** Devuelve el mensaje de error (en español) o null si los filtros son válidos. */
export function validarFiltros(f: Filtros, vista: Vista): string | null {
  if (!esFechaIso(f.desde) || !esFechaIso(f.hasta)) return 'Elige las dos fechas: «Desde» y «Hasta».';
  if (f.desde > f.hasta) return 'La fecha «Desde» no puede ser posterior a la fecha «Hasta».';
  if (f.desde < '2000-01-01' || f.hasta > '2100-01-01') return 'Las fechas no son válidas.';
  const dias = diasEntre(f.desde, f.hasta);
  const max = FUENTE[vista] === 'periodos' ? MAX_DIAS[f.periodo] : MAX_DIAS_OTROS;
  if (dias > max) {
    return FUENTE[vista] === 'periodos' && f.periodo !== 'mes'
      ? `Para ver por ${f.periodo} elige un rango de ${max} días o menos, o cambia el periodo a «Mes».`
      : `El rango es demasiado grande (máximo ${max} días).`;
  }
  return null;
}

// ---- formato -------------------------------------------------------------------------------------------------
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const ddmmaaaa = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Etiqueta de una fila de periodo; un asterisco marca el periodo «parcial» (el rango lo recorta). */
export function etiquetaPeriodo(f: Pick<FilaPeriodo, 'inicio' | 'fin' | 'parcial'>, periodo: Periodo): string {
  const marca = f.parcial ? ' *' : '';
  if (periodo === 'dia') return `${ddmmaaaa(f.inicio)}${marca}`;
  if (periodo === 'semana') return `${ddmm(f.inicio)} al ${ddmmaaaa(f.fin)}${marca}`;
  return `${MESES[Number(f.inicio.slice(5, 7)) - 1]} ${f.inicio.slice(0, 4)}${marca}`;
}
export function etiquetaCorta(f: Pick<FilaPeriodo, 'inicio'>, periodo: Periodo): string {
  if (periodo === 'mes') return `${MESES[Number(f.inicio.slice(5, 7)) - 1]} ${f.inicio.slice(2, 4)}`;
  return ddmm(f.inicio);
}

const NUM = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ENT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const pesoEn = (lb: number, u: Unidad) => (u === 'kg' ? lb / FACTOR_LB_KG : lb);
export const redondear2 = (n: number) => Math.round(n * 100) / 100;

export type TipoCol = 'texto' | 'entero' | 'peso' | 'pesoConSigno' | 'pct' | 'pctPlano';
export interface ColumnaTabla { titulo: string; tipo: TipoCol }
export type Celda = string | number | null;
export interface TablaReporte {
  id: string; titulo: string; columnas: ColumnaTabla[]; filas: Celda[][]; totales?: Celda[]; nota?: string;
}

/** Texto que se ve en pantalla y en el PDF. Los pesos llegan en libras y se muestran en la unidad elegida. */
export function textoCelda(c: Celda, tipo: TipoCol, u: Unidad): string {
  if (c === null || c === undefined || c === '') return tipo === 'texto' ? '' : '—';
  if (tipo === 'texto') return String(c);
  const n = Number(c);
  if (tipo === 'entero') return ENT.format(n);
  if (tipo === 'pct') return `${n > 0 ? '+' : ''}${NUM.format(n)} %`;
  if (tipo === 'pctPlano') return `${NUM.format(n)} %`;
  const v = pesoEn(n, u);
  return tipo === 'pesoConSigno' && v > 0 ? `+${NUM.format(v)}` : NUM.format(v);
}

/** Valor para el CSV y el Excel: número simple con 2 decimales (sin separador de miles), en la unidad elegida. */
export function valorArchivo(c: Celda, tipo: TipoCol, u: Unidad): string | number | null {
  if (c === null || c === undefined || c === '') return null;
  if (tipo === 'texto') return String(c);
  const n = Number(c);
  if (tipo === 'entero') return n;
  if (tipo === 'pct' || tipo === 'pctPlano') return redondear2(n);
  return redondear2(pesoEn(n, u));
}

/** Celda del CSV: pesos y porcentajes siempre con 2 decimales. */
export function valorCsv(c: Celda, tipo: TipoCol, u: Unidad): string | number | null {
  const v = valorArchivo(c, tipo, u);
  return typeof v === 'number' && (tipo === 'peso' || tipo === 'pesoConSigno' || tipo === 'pct' || tipo === 'pctPlano') ? v.toFixed(2) : v;
}

export const unidadTexto = (u: Unidad) => (u === 'kg' ? 'kg' : 'lb');

// ---- tablas de cada vista --------------------------------------------------------------------------------------
const colTitulo = (t: string, u: Unidad) => t.replace('{u}', unidadTexto(u));

export function construirTablas(vista: Vista, datos: DatosReporte, periodo: Periodo, u: Unidad): TablaReporte[] {
  if (vista === 'libras' || vista === 'lotes') {
    const d = datos as RespPeriodos;
    const nombrePeriodo = PERIODOS.find((p) => p.id === periodo)?.texto ?? '';
    const hayParcial = d.filas.some((f) => f.parcial);
    const nota = hayParcial ? '* Periodo parcial: el rango elegido lo recorta (empieza o termina a mitad del periodo).' : undefined;
    if (vista === 'libras') {
      return [{
        id: 'libras', titulo: `Libras planta por ${periodo}`,
        columnas: [
          { titulo: nombrePeriodo, tipo: 'texto' }, { titulo: 'Recepciones', tipo: 'entero' },
          { titulo: colTitulo('Libras planta ({u})', u), tipo: 'peso' }, { titulo: colTitulo('Libras reportadas ({u})', u), tipo: 'peso' },
          { titulo: colTitulo('Diferencia ({u})', u), tipo: 'pesoConSigno' }, { titulo: 'Diferencia %', tipo: 'pct' },
        ],
        filas: d.filas.map((f) => [etiquetaPeriodo(f, periodo), f.recepciones, f.libras_planta, f.libras_reportadas, f.diferencia_lb, f.diferencia_pct]),
        totales: ['Total', d.totales.recepciones, d.totales.libras_planta, d.totales.libras_reportadas, d.totales.diferencia_lb, d.totales.diferencia_pct],
        nota,
      }];
    }
    return [{
      id: 'lotes', titulo: `Lotes por ${periodo}`,
      columnas: [{ titulo: nombrePeriodo, tipo: 'texto' }, { titulo: 'Lotes', tipo: 'entero' }, { titulo: 'Recepciones', tipo: 'entero' }],
      filas: d.filas.map((f) => [etiquetaPeriodo(f, periodo), f.lotes, f.recepciones]),
      totales: ['Total (lotes distintos)', d.totales.lotes, d.totales.recepciones],
      nota: ['El total cuenta lotes distintos: un lote que llegó en varios periodos cuenta una vez en el total, por eso puede ser menor que la suma de la columna.', nota].filter(Boolean).join(' '),
    }];
  }
  if (vista === 'proveedores') {
    const d = datos as RespProveedores;
    return [{
      id: 'proveedores', titulo: 'Proveedores con recepciones',
      columnas: [{ titulo: 'Proveedor', tipo: 'texto' }, { titulo: 'Recepciones', tipo: 'entero' }, { titulo: 'Lotes', tipo: 'entero' }],
      filas: d.filas.map((f) => [f.proveedor, f.recepciones, f.lotes]),
      totales: [`Total (${d.proveedores_con_recepcion} proveedores)`, d.totales.recepciones, d.totales.lotes],
      nota: `Proveedores con recepciones en el rango: ${d.proveedores_con_recepcion}. Proveedores registrados en el catálogo: ${d.proveedores_catalogo}.`,
    }];
  }
  if (vista === 'libras_proveedor') {
    const d = datos as RespProveedores;
    return [{
      id: 'libras_proveedor', titulo: 'Libras por proveedor',
      columnas: [
        { titulo: 'Proveedor', tipo: 'texto' }, { titulo: 'Recepciones', tipo: 'entero' },
        { titulo: colTitulo('Libras planta ({u})', u), tipo: 'peso' }, { titulo: colTitulo('Libras reportadas ({u})', u), tipo: 'peso' },
        { titulo: colTitulo('Diferencia ({u})', u), tipo: 'pesoConSigno' }, { titulo: '% del total', tipo: 'pctPlano' },
      ],
      filas: d.filas.map((f) => [f.proveedor, f.recepciones, f.libras_planta, f.libras_reportadas, f.diferencia_lb, f.porcentaje]),
      totales: ['Total', d.totales.recepciones, d.totales.libras_planta, d.totales.libras_reportadas, d.filas.reduce((s, f) => s + f.diferencia_lb, 0), d.filas.length ? 100 : null],
    }];
  }
  const d = datos as RespEspecie;
  return [
    {
      id: 'especie_proveedor', titulo: 'Especie por proveedor',
      columnas: [
        { titulo: 'Proveedor', tipo: 'texto' }, { titulo: 'Especie', tipo: 'texto' }, { titulo: 'Recepciones', tipo: 'entero' },
        { titulo: 'Lotes', tipo: 'entero' }, { titulo: colTitulo('Libras planta ({u})', u), tipo: 'peso' },
      ],
      filas: d.filas.map((f) => [f.proveedor, f.especie, f.recepciones, f.lotes, f.libras_planta]),
      totales: ['Total', null, d.totales.recepciones, d.totales.lotes, d.totales.libras_planta],
    },
    {
      id: 'total_especie', titulo: 'Total por especie',
      columnas: [
        { titulo: 'Especie', tipo: 'texto' }, { titulo: 'Proveedores', tipo: 'entero' }, { titulo: 'Recepciones', tipo: 'entero' },
        { titulo: 'Lotes', tipo: 'entero' }, { titulo: colTitulo('Libras planta ({u})', u), tipo: 'peso' },
      ],
      filas: d.por_especie.map((f) => [f.especie, f.proveedores, f.recepciones, f.lotes, f.libras_planta]),
    },
  ];
}

// ---- gráficos --------------------------------------------------------------------------------------------------
export interface BarraGrafico { etiqueta: string; etiquetaCorta: string; valor: number; texto: string }
export interface DatosGrafico { titulo: string; unidad: string; barras: BarraGrafico[]; horizontal: boolean; nota?: string }
const TOP = 10;

export function datosGrafico(vista: Vista, datos: DatosReporte, periodo: Periodo, u: Unidad): DatosGrafico {
  const peso = (lb: number) => redondear2(pesoEn(lb, u));
  if (vista === 'libras' || vista === 'lotes') {
    const d = datos as RespPeriodos;
    const lib = vista === 'libras';
    return {
      titulo: lib ? `Libras planta por ${periodo}` : `Lotes por ${periodo}`, unidad: lib ? unidadTexto(u) : 'lotes', horizontal: false,
      barras: d.filas.map((f) => {
        const v = lib ? peso(f.libras_planta) : f.lotes;
        return { etiqueta: etiquetaPeriodo(f, periodo), etiquetaCorta: etiquetaCorta(f, periodo), valor: v, texto: lib ? NUM.format(v) : ENT.format(v) };
      }),
    };
  }
  if (vista === 'proveedores' || vista === 'libras_proveedor') {
    const d = datos as RespProveedores;
    const lib = vista === 'libras_proveedor';
    const orden = [...d.filas].sort((a, b) => (lib ? b.libras_planta - a.libras_planta : b.recepciones - a.recepciones) || a.proveedor.localeCompare(b.proveedor));
    const barras = orden.slice(0, TOP).map((f) => {
      const v = lib ? peso(f.libras_planta) : f.recepciones;
      return { etiqueta: f.proveedor, etiquetaCorta: f.proveedor, valor: v, texto: lib ? NUM.format(v) : ENT.format(v) };
    });
    return {
      titulo: lib ? 'Libras por proveedor (los 10 mayores)' : 'Recepciones por proveedor (los 10 con más)', unidad: lib ? unidadTexto(u) : 'recepciones', horizontal: true, barras,
      nota: d.filas.length > TOP ? `Se grafican los ${TOP} primeros; la tabla muestra los ${d.filas.length}.` : undefined,
    };
  }
  const d = datos as RespEspecie;
  return {
    titulo: 'Libras por especie', unidad: unidadTexto(u), horizontal: true,
    barras: d.por_especie.slice(0, TOP).map((f) => { const v = peso(f.libras_planta); return { etiqueta: f.especie, etiquetaCorta: f.especie, valor: v, texto: NUM.format(v) }; }),
    nota: d.por_especie.length > TOP ? `Se grafican las ${TOP} primeras especies.` : undefined,
  };
}

/** Marcas del eje con valores «redondos» (1, 2, 5 × 10ⁿ) para que el gráfico se lea fácil. */
export function escalaEje(maximo: number, marcas = 4): { tope: number; valores: number[] } {
  if (!(maximo > 0)) return { tope: 1, valores: [0, 1] };
  const bruto = maximo / marcas;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto) ?? 10 * pot;
  const n = Math.ceil(maximo / paso);
  return { tope: n * paso, valores: Array.from({ length: n + 1 }, (_, i) => i * paso) };
}

// ---- archivos --------------------------------------------------------------------------------------------------
const peligrosa = /^[=+\-@\t\r]/;
/** Una celda de CSV: texto entre comillas si hace falta; los textos que empiezan con =, +, - o @ llevan un apóstrofo delante (protege contra fórmulas). */
export function celdaCsv(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (/^-?\d+(\.\d+)?$/.test(v)) return v; // número ya formateado (puede ser negativo)
  let t = v;
  if (peligrosa.test(t)) t = `'${t}`;
  return /[",\r\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export interface CabeceraArchivo { titulo: string; rango: string; estados: string; unidad: string; generado: string }

/** CSV con separador coma, decimales con punto, UTF-8 con marca BOM (para que Excel respete las tildes). */
export function construirCsv(tablas: TablaReporte[], cab: CabeceraArchivo, u: Unidad): string {
  const L: string[] = [];
  L.push(celdaCsv(cab.titulo));
  L.push([celdaCsv('Rango'), celdaCsv(cab.rango)].join(','));
  L.push([celdaCsv('Recepciones incluidas'), celdaCsv(cab.estados)].join(','));
  L.push([celdaCsv('Unidad de peso'), celdaCsv(cab.unidad)].join(','));
  L.push([celdaCsv('Generado'), celdaCsv(cab.generado)].join(','));
  for (const t of tablas) {
    L.push('');
    L.push(celdaCsv(t.titulo));
    L.push(t.columnas.map((c) => celdaCsv(c.titulo)).join(','));
    for (const f of t.filas) L.push(f.map((c, i) => celdaCsv(valorCsv(c, t.columnas[i].tipo, u))).join(','));
    if (t.totales) L.push(t.totales.map((c, i) => celdaCsv(valorCsv(c, t.columnas[i].tipo, u))).join(','));
    if (t.nota) L.push(celdaCsv(t.nota));
  }
  return '﻿' + L.join('\r\n') + '\r\n';
}

const seguro = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
export function nombreArchivoReporte(vista: Vista, periodo: Periodo, f: Pick<Filtros, 'desde' | 'hasta'>, ext: 'csv' | 'xlsx' | 'pdf'): string {
  const base = VISTAS.find((v) => v.id === vista)?.titulo ?? vista;
  const per = FUENTE[vista] === 'periodos' ? `_por_${periodo}` : '';
  return `Reporte_${seguro(base)}${per}_${f.desde}_${f.hasta}.${ext}`;
}
export const textoEstados = (borradores: boolean) => (borradores ? 'Cerradas y borradores (no incluye anuladas ni eliminadas)' : 'Solo cerradas (no incluye anuladas, eliminadas ni borradores)');
export const textoRango = (f: Pick<Filtros, 'desde' | 'hasta'>) => `Del ${ddmmaaaa(f.desde)} al ${ddmmaaaa(f.hasta)}`;
