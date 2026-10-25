export interface GavetaForm { num_gaveta: number; peso_lb: number }
export interface TemperaturaForm { lectura_id: number; bines: string; temperatura_c: number }
export interface AlmacenamientoForm {
  num_bin: string; sellos_recepcion: string; sellos_almacenamiento: string; temperatura_c: number | null; libras_aprox: number | null;
}

/** Estado del formulario en pantalla. Los pesos siempre en LIBRAS. */
export interface FormRecepcion {
  fecha_llegada: string;
  placa_vehiculo: string;
  lote_id: string;
  proveedor: string;
  especie: string;
  piscina: string;
  guia_remision: string;
  num_gavetas_bines: string;
  libras_reportadas: number | null;
  libras_planta: number | null;
  hora_inicio_descarga: string;
  hora_fin_descarga: string;
  observacion: string;
  // Se llenan en la Parte 7; en la Parte 6 viajan vacías.
  gavetas: GavetaForm[];
  temperaturas: TemperaturaForm[];
  almacenamiento: AlmacenamientoForm[];
}

export type CampoForm = keyof FormRecepcion | 'general';
export type Errores = Partial<Record<CampoForm, string>>;

export interface ItemCatalogo { id: string; nombre: string }

export interface InfoLote {
  existe: boolean;
  lote_id: string;
  proveedor_nombre?: string;
  especie_nombre?: string | null;
  camiones: number;
  libras_reportadas: number;
  libras_planta: number;
}

export interface RespuestaGuardar { recepcion_id: string; version: number; estado: 'borrador' | 'cerrado'; duplicado: boolean }

export interface ConfigPublica { factor_lb_kg?: number; formato_lote?: string; max_fotos_recepcion?: number }

export const FORMATO_LOTE_POR_DEFECTO =
  '^([A-Z]?[0-9]{3}|[0-9]{3}[A-Z]?)(-([A-Z]?[0-9]{3}|[0-9]{3}[A-Z]?)){2}$';
