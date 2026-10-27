import type { Unidad } from '../../../lib/unidades';
import { construirXlsx } from '../../../lib/xlsx';
import { construirCsv, nombreArchivoReporte, valorArchivo, type CabeceraArchivo, type Filtros, type TablaReporte, type Vista } from './reportes';

function bajar(bytes: BlobPart, tipo: string, nombre: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
async function leerLogo(): Promise<Uint8Array | undefined> {
  try { const r = await fetch('/logo.png'); return r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined; } catch { return undefined; }
}

export interface ContextoDescarga { vista: Vista; filtros: Filtros; tablas: TablaReporte[]; cab: CabeceraArchivo; unidad: Unidad; generadoPor?: string }

export function descargarCsv(c: ContextoDescarga): string {
  const nombre = nombreArchivoReporte(c.vista, c.filtros.periodo, c.filtros, 'csv');
  bajar(construirCsv(c.tablas, c.cab, c.unidad), 'text/csv;charset=utf-8', nombre);
  return nombre;
}

export function descargarXlsx(c: ContextoDescarga): string {
  const nombre = nombreArchivoReporte(c.vista, c.filtros.periodo, c.filtros, 'xlsx');
  const hojas = c.tablas.map((t, i) => ({
    nombre: i === 0 ? t.titulo : t.titulo,
    columnas: t.columnas.map((col) => ({ titulo: col.titulo, formato: col.tipo === 'texto' ? ('texto' as const) : col.tipo === 'entero' ? ('entero' as const) : ('dec2' as const), ancho: col.tipo === 'texto' ? 30 : 18 })),
    filas: [...t.filas, ...(t.totales ? [t.totales] : [])].map((f) => f.map((x, j) => valorArchivo(x, t.columnas[j].tipo, c.unidad))),
  }));
  bajar(construirXlsx(hojas) as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', nombre);
  return nombre;
}

export async function descargarPdf(c: ContextoDescarga): Promise<string> {
  const { generarPdfReporte } = await import('./reportePdf');
  const nombre = nombreArchivoReporte(c.vista, c.filtros.periodo, c.filtros, 'pdf');
  bajar(await generarPdfReporte(c.tablas, c.cab, c.unidad, { logo: await leerLogo(), generadoPor: c.generadoPor }) as BlobPart, 'application/pdf', nombre);
  return nombre;
}
