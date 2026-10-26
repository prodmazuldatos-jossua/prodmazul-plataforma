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

export type EstadoRecepcion = 'borrador' | 'cerrado' | 'anulado' | 'eliminado';

/** Una fila del listado (api_m01_listar_recepciones). */
export interface ItemListado {
  recepcion_id: string; fecha_llegada: string; lote_id: string; proveedor_nombre: string; especie_nombre: string;
  guia_remision: string; placa_vehiculo: string | null; num_gavetas_bines: number; llegada_en: 'bines' | 'gavetas';
  libras_reportadas: number | null; libras_planta: number | null; diferencia_lb: number | null; diferencia_pct: number | null;
  estado: EstadoRecepcion; version: number; realizado_por_nombre: string | null; modificado_en: string;
  creado_por: string | null; lote_cerrado: boolean | null; motivo_anulacion: string | null;
}
export interface RespuestaListado { total: number; items: ItemListado[] }

export interface FiltrosListado {
  busqueda: string; estado: 'activos' | 'todos' | 'borrador' | 'cerrado' | 'anulado' | 'eliminado'; desde: string; hasta: string;
  limite: number; desplazamiento: number;
}

/** Recepción completa (api_m01_obtener_recepcion). */
export interface RecepcionDetalle {
  recepcion_id: string; version: number; estado: EstadoRecepcion; estado_previo: EstadoRecepcion | null;
  fecha_llegada: string; placa_vehiculo: string | null; lote_id: string; piscina: string | null; guia_remision: string;
  llegada_en: 'bines' | 'gavetas'; num_gavetas_bines: number; libras_reportadas: number | null; libras_planta: number | null;
  diferencia_lb: number | null; diferencia_pct: number | null; peso_promedio_gaveta?: number | null;
  hora_inicio_descarga: string | null; hora_fin_descarga: string | null; observacion: string | null;
  proveedor_nombre: string; especie_nombre: string; realizado_por_nombre: string | null; lote_cerrado: boolean | null;
  creado_por: string | null; creado_en?: string; modificado_en: string;
  motivo_anulacion: string | null; anulado_en: string | null; eliminado_en: string | null;
  gavetas: { num_gaveta: number; peso_lb: number }[];
  temperaturas: { lectura_id: number; num_gaveta: number | null; temperatura_c: number }[];
  almacenamiento: { num_bin: string; sellos_recepcion: string | null; sellos_almacenamiento: string | null; temperatura_c: number | null; libras_aprox: number | null }[];
  fotos: { foto_id: string; nn: number; nombre: string }[];
}

export interface RespuestaEstado { recepcion_id: string; estado: EstadoRecepcion; version: number }

/** Una foto ya guardada de una recepción (api_m01_fotos_recepcion). */
export interface FotoRemota {
  foto_id: string; nn: number; nombre: string; tipo_mime: string; tamano_bytes: number; ruta: string; subido_en: string;
  /** true cuando la foto ya se borró de Supabase (pasó la retención) y solo queda la copia en Drive. */
  archivada?: boolean;
  archivada_en?: string | null;
}

/** Una foto elegida en el formulario que todavía no se sube (se sube al guardar la recepción). */
export interface FotoNueva {
  id: string;
  nombre: string;
  tipo: string;
  blob?: Blob;
  tamano: number;
  previewUrl: string;
  estado: 'comprimiendo' | 'lista' | 'subiendo' | 'error';
  error?: string;
}

export interface RespuestaRegistroFoto { foto_id: string; nn: number; ruta: string }
