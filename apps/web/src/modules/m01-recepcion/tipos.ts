export const NUM_GAVETAS_MAX = 30;
export const LECTURAS_POR_DEFECTO = 2;
export const MAX_LECTURAS = 30;
export const MAX_FILAS_ALMACENAMIENTO = 40;

/** Una lectura de temperatura: el número de gaveta (1 a 30) a la que corresponde y su valor en °C. */
export interface LecturaForm { num_gaveta: number | null; temperatura_c: number | null }

/** Una fila de «Almacenamiento de materia prima». Las filas totalmente vacías se ignoran al guardar. */
export interface AlmacenamientoForm {
  num_bin: string; sellos_recepcion: string; sellos_almacenamiento: string; temperatura_c: number | null; libras_aprox: number | null;
}

export const filaAlmacenamientoVacia = (): AlmacenamientoForm =>
  ({ num_bin: '', sellos_recepcion: '', sellos_almacenamiento: '', temperatura_c: null, libras_aprox: null });
export const lecturaVacia = (): LecturaForm => ({ num_gaveta: null, temperatura_c: null });
export const lecturasVacias = (): LecturaForm[] => Array.from({ length: LECTURAS_POR_DEFECTO }, lecturaVacia);
export const gavetasVacias = (): (number | null)[] => Array.from({ length: NUM_GAVETAS_MAX }, () => null);

/** Estado del formulario en pantalla. Los pesos siempre en LIBRAS. */
export interface FormRecepcion {
  fecha_llegada: string;
  placa_vehiculo: string;
  lote_id: string;
  proveedor: string;
  especie: string;
  piscina: string;
  guia_remision: string;
  /** Cómo llegó el producto: en bines (por defecto) o en gavetas. */
  llegada_en: 'bines' | 'gavetas';
  num_gavetas_bines: string;
  libras_reportadas: number | null;
  libras_planta: number | null;
  hora_inicio_descarga: string;
  hora_fin_descarga: string;
  observacion: string;
  /** Las 30 casillas de peso de gaveta (posición 0 = gaveta 1). null = sin pesar. */
  gavetas: (number | null)[];
  /** Temperaturas de referencia de algunas gavetas (por defecto 2 filas; se pueden agregar más). */
  temperaturas: LecturaForm[];
  /** true = este es el último camión del lote y el lote se cierra al guardar y cerrar. */
  cerrar_lote: boolean;
  almacenamiento: AlmacenamientoForm[];
}

export type CampoForm = keyof FormRecepcion | 'general';

/** Errores por fila de las secciones repetidas (la clave es la posición, empezando en 0). */
export interface ErroresFilas {
  gavetas: Record<number, string>;
  lecturas: Record<number, { num_gaveta?: string; temperatura_c?: string }>;
  almacenamiento: Record<number, Partial<Record<keyof AlmacenamientoForm, string>>>;
}
export type Errores = Partial<Record<CampoForm, string>> & { filas?: ErroresFilas };

export interface ItemCatalogo { id: string; nombre: string }

export interface InfoLote {
  existe: boolean;
  lote_id: string;
  proveedor_nombre?: string;
  especie_nombre?: string | null;
  cerrado?: boolean;
  camiones: number;
  libras_reportadas: number;
  libras_planta: number;
}

export interface RespuestaGuardar { recepcion_id: string; version: number; estado: 'borrador' | 'cerrado'; duplicado: boolean; lote_cerrado?: boolean }

export interface ConfigPublica { factor_lb_kg?: number; formato_lote?: string; max_fotos_recepcion?: number }

export const FORMATO_LOTE_POR_DEFECTO =
  '^([A-Z]?[0-9]{3}|[0-9]{3}[A-Z]?)(-([A-Z]?[0-9]{3}|[0-9]{3}[A-Z]?)){2}$';
