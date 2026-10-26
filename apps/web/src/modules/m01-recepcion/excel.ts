import { construirXlsx, type HojaXlsx } from '../../lib/xlsx';
import type { EstadoRecepcion } from './tipos';

/** Lo que devuelve api_m01_exportar: todas las columnas guardadas (pesos en libras, tal como se guardan). */
export interface DatosExportacion {
  generado_en: string;
  recepciones: Record<string, unknown>[];
  gavetas: Record<string, unknown>[];
  temperaturas: Record<string, unknown>[];
  almacenamiento: Record<string, unknown>[];
  fotos: Record<string, unknown>[];
}

const ESTADO: Record<EstadoRecepcion, string> = { borrador: 'Borrador', cerrado: 'Cerrada', anulado: 'Anulada', eliminado: 'Eliminada' };
const siNo = (v: unknown) => (v === null || v === undefined ? '' : v ? 'Sí' : 'No');
const llegada = (v: unknown) => (v === 'gavetas' ? 'Gavetas' : v === 'bines' ? 'Bines' : '');

type Def = { titulo: string; campo: string; formato?: import('../../lib/xlsx').FormatoColumna; ancho?: number; ver?: (v: unknown) => unknown };

function hoja(nombre: string, defs: Def[], filas: Record<string, unknown>[]): HojaXlsx {
  return {
    nombre,
    columnas: defs.map((d) => ({ titulo: d.titulo, formato: d.formato, ancho: d.ancho })),
    filas: filas.map((f) => defs.map((d) => (d.ver ? d.ver(f[d.campo]) : f[d.campo]))),
  };
}

const RECEPCIONES: Def[] = [
  { titulo: 'N.º de recepción', campo: 'recepcion_id', ancho: 20 },
  { titulo: 'Estado', campo: 'estado', ancho: 12, ver: (v) => ESTADO[v as EstadoRecepcion] ?? String(v ?? '') },
  { titulo: 'Estado previo', campo: 'estado_previo', ancho: 12, ver: (v) => (v ? ESTADO[v as EstadoRecepcion] ?? String(v) : '') },
  { titulo: 'Versión', campo: 'version', formato: 'entero', ancho: 9 },
  { titulo: 'Fecha de llegada', campo: 'fecha_llegada', formato: 'fecha', ancho: 14 },
  { titulo: 'Placa del vehículo', campo: 'placa_vehiculo', ancho: 14 },
  { titulo: 'Lote', campo: 'lote_id', ancho: 14 },
  { titulo: 'Lote cerrado', campo: 'lote_cerrado', ancho: 10, ver: siNo },
  { titulo: 'Proveedor', campo: 'proveedor', ancho: 28 },
  { titulo: 'Especie', campo: 'especie', ancho: 18 },
  { titulo: 'Piscina', campo: 'piscina', ancho: 12 },
  { titulo: 'Guía de remisión', campo: 'guia_remision', ancho: 18 },
  { titulo: 'El producto llegó en', campo: 'llegada_en', ancho: 12, ver: llegada },
  { titulo: 'N.º de gavetas o bines', campo: 'num_gavetas_bines', formato: 'entero', ancho: 12 },
  { titulo: 'Libras reportadas (lb)', campo: 'libras_reportadas', formato: 'dec2', ancho: 14 },
  { titulo: 'Libras de planta (lb)', campo: 'libras_planta', formato: 'dec2', ancho: 14 },
  { titulo: 'Diferencia (lb)', campo: 'diferencia_lb', formato: 'dec2', ancho: 13 },
  { titulo: 'Diferencia (%)', campo: 'diferencia_pct', formato: 'dec2', ancho: 12 },
  { titulo: 'Peso promedio por gaveta (lb)', campo: 'peso_promedio_lb', formato: 'dec2', ancho: 16 },
  { titulo: 'Hora de inicio de descarga', campo: 'hora_inicio_descarga', formato: 'hora', ancho: 14 },
  { titulo: 'Hora de fin de descarga', campo: 'hora_fin_descarga', formato: 'hora', ancho: 14 },
  { titulo: 'Duración de la descarga (min)', campo: 'duracion_descarga_min', formato: 'entero', ancho: 14 },
  { titulo: 'Observación', campo: 'observacion', ancho: 40 },
  { titulo: 'Gavetas pesadas', campo: 'gavetas_pesadas', formato: 'entero', ancho: 11 },
  { titulo: 'Peso total de las gavetas (lb)', campo: 'peso_total_gavetas_lb', formato: 'dec2', ancho: 16 },
  { titulo: 'Lecturas de temperatura', campo: 'lecturas_temperatura', formato: 'entero', ancho: 12 },
  { titulo: 'Bines de almacenamiento', campo: 'bines_almacenamiento', formato: 'entero', ancho: 12 },
  { titulo: 'Fotos', campo: 'fotos', formato: 'entero', ancho: 8 },
  { titulo: 'Realizado por', campo: 'realizado_por', ancho: 24 },
  { titulo: 'Correo de quien lo realizó', campo: 'realizado_por_correo', ancho: 28 },
  { titulo: 'Revisado por', campo: 'revisado_por', ancho: 24 },
  { titulo: 'Motivo de anulación', campo: 'motivo_anulacion', ancho: 32 },
  { titulo: 'Anulada el', campo: 'anulado_en', formato: 'fechahora', ancho: 17 },
  { titulo: 'Anulada por', campo: 'anulado_por', ancho: 24 },
  { titulo: 'Eliminada el', campo: 'eliminado_en', formato: 'fechahora', ancho: 17 },
  { titulo: 'Eliminada por', campo: 'eliminado_por', ancho: 24 },
  { titulo: 'Creada el', campo: 'creado_en', formato: 'fechahora', ancho: 17 },
  { titulo: 'Creada por', campo: 'creado_por', ancho: 24 },
  { titulo: 'Última modificación', campo: 'modificado_en', formato: 'fechahora', ancho: 17 },
  { titulo: 'Modificada por', campo: 'modificado_por', ancho: 24 },
  { titulo: 'Identificador de envío', campo: 'client_uuid', ancho: 38 },
];

/** Arma las hojas del libro: una fila por recepción y una hoja por cada tabla que se guarda con ella. */
export function hojasExcel(d: DatosExportacion): HojaXlsx[] {
  return [
    hoja('Recepciones', RECEPCIONES, d.recepciones),
    hoja('Gavetas', [
      { titulo: 'N.º de recepción', campo: 'recepcion_id', ancho: 20 },
      { titulo: 'N.º de gaveta', campo: 'num_gaveta', formato: 'entero', ancho: 12 },
      { titulo: 'Peso (lb)', campo: 'peso_lb', formato: 'dec2', ancho: 12 },
    ], d.gavetas),
    hoja('Temperaturas', [
      { titulo: 'N.º de recepción', campo: 'recepcion_id', ancho: 20 },
      { titulo: 'Lectura', campo: 'lectura_id', formato: 'entero', ancho: 10 },
      { titulo: 'N.º de gaveta', campo: 'num_gaveta', formato: 'entero', ancho: 12 },
      { titulo: 'Temperatura (°C)', campo: 'temperatura_c', formato: 'dec1', ancho: 16 },
    ], d.temperaturas),
    hoja('Almacenamiento', [
      { titulo: 'N.º de recepción', campo: 'recepcion_id', ancho: 20 },
      { titulo: 'N.º de bin', campo: 'num_bin', ancho: 12 },
      { titulo: 'N.º de sello de recepción', campo: 'sellos_recepcion', ancho: 20 },
      { titulo: 'N.º de sello de almacenamiento', campo: 'sellos_almacenamiento', ancho: 22 },
      { titulo: 'Temperatura (°C)', campo: 'temperatura_c', formato: 'dec1', ancho: 16 },
      { titulo: 'Libras aproximadas (lb)', campo: 'libras_aprox', formato: 'dec2', ancho: 16 },
    ], d.almacenamiento),
    hoja('Fotos', [
      { titulo: 'N.º de recepción', campo: 'recepcion_id', ancho: 20 },
      { titulo: 'N.º de foto', campo: 'nn', formato: 'entero', ancho: 10 },
      { titulo: 'Nombre del archivo', campo: 'nombre', ancho: 34 },
      { titulo: 'Tipo', campo: 'tipo_mime', ancho: 12 },
      { titulo: 'Tamaño (bytes)', campo: 'tamano_bytes', formato: 'entero', ancho: 14 },
      { titulo: 'Subida el', campo: 'subido_en', formato: 'fechahora', ancho: 17 },
      { titulo: 'Confirmada', campo: 'confirmada', ancho: 11, ver: siNo },
      { titulo: 'Respaldada en Drive el', campo: 'respaldo_drive_en', formato: 'fechahora', ancho: 18 },
    ], d.fotos),
  ];
}

export function construirExcel(d: DatosExportacion): Uint8Array {
  return construirXlsx(hojasExcel(d));
}

/** Nombre del archivo con la fecha y hora de Ecuador: recepciones_2026-10-25_2316.xlsx */
export function nombreArchivoExcel(ahora: Date = new Date()): string {
  const e = new Date(ahora.getTime() - 5 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `recepciones_${e.getUTCFullYear()}-${p(e.getUTCMonth() + 1)}-${p(e.getUTCDate())}_${p(e.getUTCHours())}${p(e.getUTCMinutes())}.xlsx`;
}
