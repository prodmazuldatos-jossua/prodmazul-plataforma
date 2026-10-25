import { FORMATO_LOTE_POR_DEFECTO, type Errores, type FormRecepcion } from './tipos';
import { normalizar } from '../../lib/texto';

export interface ContextoValidacion {
  /** Expresión regular del lote (viene de la configuración de la base de datos). */
  formatoLote: string;
  /** Fecha de hoy en Ecuador (AAAA-MM-DD). */
  hoy: string;
  /** true al «Guardar y cerrar»: exige más datos que un borrador. */
  cerrando: boolean;
  /** true si el lote ya existe (su proveedor se hereda) o false si es nuevo; null si aún no se sabe. */
  loteExiste: boolean | null;
}

export function loteValido(lote: string, formatoLote: string = FORMATO_LOTE_POR_DEFECTO): boolean {
  try { return new RegExp(formatoLote, 'i').test(lote.trim()); } catch { return false; }
}

/** Mismas reglas que la base de datos, para avisar en el campo antes de enviar. Devuelve un mensaje por campo. */
export function validarRecepcion(f: FormRecepcion, c: ContextoValidacion): Errores {
  const e: Errores = {};

  if (!f.fecha_llegada) e.fecha_llegada = 'La fecha de llegada es obligatoria.';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha_llegada)) e.fecha_llegada = 'La fecha no es válida.';
  else if (f.fecha_llegada > c.hoy) e.fecha_llegada = 'La fecha de llegada no puede ser futura.';

  if (!f.guia_remision.trim()) e.guia_remision = 'La guía de remisión es obligatoria.';

  const lote = f.lote_id.trim();
  if (!lote) e.lote_id = 'El lote es obligatorio.';
  else if (!loteValido(lote, c.formatoLote)) e.lote_id = 'El formato no es válido. Son 3 grupos separados por guion, por ejemplo 123-456-789 o 123-456A-789.';

  if (!f.especie.trim()) e.especie = 'La especie es obligatoria.';
  if (c.loteExiste !== true && !f.proveedor.trim()) e.proveedor = 'El proveedor es obligatorio cuando el lote es nuevo.';

  const n = f.num_gavetas_bines.trim();
  if (!n) e.num_gavetas_bines = 'Indica cuántas gavetas o bines llegaron.';
  else if (!/^\d+$/.test(n) || Number(n) < 1) e.num_gavetas_bines = 'Debe ser un número entero de 1 o más.';
  else if (Number(n) > 9999) e.num_gavetas_bines = 'El número es demasiado grande.';

  if (f.libras_reportadas !== null && f.libras_reportadas <= 0) e.libras_reportadas = 'Debe ser mayor que cero.';
  if (f.libras_planta !== null && f.libras_planta <= 0) e.libras_planta = 'Debe ser mayor que cero.';

  if (f.hora_inicio_descarga && f.hora_fin_descarga && f.hora_fin_descarga < f.hora_inicio_descarga) {
    e.hora_fin_descarga = 'La hora de fin no puede ser anterior a la de inicio.';
  }
  if (f.observacion.length > 2000) e.observacion = 'La observación no puede superar los 2000 caracteres.';

  if (c.cerrando) {
    if (f.libras_reportadas === null && !e.libras_reportadas) e.libras_reportadas = 'Para cerrar indica las libras reportadas.';
    if (f.libras_planta === null && !e.libras_planta) e.libras_planta = 'Para cerrar indica las libras de planta.';
    if (f.gavetas.length === 0) {
      e.general = 'Para cerrar la recepción hay que registrar el peso de al menos una gaveta. Esa sección se activa en la Parte 7; mientras tanto puedes guardar como borrador.';
    }
  }
  return e;
}

/** Construye lo que recibe api_m01_guardar_recepcion. */
export function aPayload(
  f: FormRecepcion,
  extra: { client_uuid: string; estado: 'borrador' | 'cerrado'; recepcion_id?: string; version?: number; loteExiste: boolean | null },
): Record<string, unknown> {
  const texto = (t: string) => (t.trim() === '' ? null : t.trim());
  const p: Record<string, unknown> = {
    client_uuid: extra.client_uuid,
    estado: extra.estado,
    fecha_llegada: f.fecha_llegada,
    placa_vehiculo: texto(f.placa_vehiculo),
    lote_id: f.lote_id.trim().toUpperCase(),
    especie: f.especie.trim(),
    piscina: texto(f.piscina),
    guia_remision: f.guia_remision.trim(),
    num_gavetas_bines: Number(f.num_gavetas_bines),
    libras_reportadas: f.libras_reportadas,
    libras_planta: f.libras_planta,
    hora_inicio_descarga: texto(f.hora_inicio_descarga),
    hora_fin_descarga: texto(f.hora_fin_descarga),
    observacion: texto(f.observacion),
    gavetas: f.gavetas,
    temperaturas: f.temperaturas,
    almacenamiento: f.almacenamiento,
  };
  // El proveedor solo se envía si el lote es nuevo: en un lote existente lo manda la base de datos.
  if (extra.loteExiste !== true) p.proveedor = f.proveedor.trim();
  if (extra.recepcion_id) { p.recepcion_id = extra.recepcion_id; p.version = extra.version; }
  return p;
}

export function mismoNombre(a: string, b: string): boolean { return normalizar(a) === normalizar(b); }
