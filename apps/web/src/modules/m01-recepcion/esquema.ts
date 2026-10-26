import {
  FORMATO_LOTE_POR_DEFECTO, MAX_LECTURAS, NUM_GAVETAS_MAX, type AlmacenamientoForm, type Errores, type ErroresFilas, type FormRecepcion,
} from './tipos';
import { normalizar } from '../../lib/texto';
import { totalPesos } from './calculos';

export interface ContextoValidacion {
  /** Expresión regular del lote (viene de la configuración de la base de datos). */
  formatoLote: string;
  /** Fecha de hoy en Ecuador (AAAA-MM-DD). */
  hoy: string;
  /** true al «Guardar y cerrar»: exige más datos que un borrador. */
  cerrando: boolean;
  /** true si el lote ya existe (su proveedor se hereda) o false si es nuevo; null si aún no se sabe. */
  loteExiste: boolean | null;
  /** true si el lote ya está cerrado y la recepción es nueva: no se admiten más camiones. */
  loteCerrado?: boolean;
  /** Cómo se escribe un peso en la unidad elegida (para los mensajes). */
  pesoTexto?: (lb: number) => string;
}

export const TEMPERATURA_MIN = -50;
export const TEMPERATURA_MAX = 50;

export function loteValido(lote: string, formatoLote: string = FORMATO_LOTE_POR_DEFECTO): boolean {
  try { return new RegExp(formatoLote, 'i').test(lote.trim()); } catch { return false; }
}

/** Una fila de almacenamiento está «en uso» si tiene cualquier dato; las totalmente vacías se ignoran. */
export function filaEnUso(f: AlmacenamientoForm): boolean {
  return f.num_bin.trim() !== '' || f.sellos_recepcion.trim() !== '' || f.sellos_almacenamiento.trim() !== ''
    || f.temperatura_c !== null || f.libras_aprox !== null;
}

/** Gavetas con peso registrado: son las únicas a las que se les puede poner una temperatura. */
export function gavetasConPeso(gavetas: (number | null)[]): number[] {
  return gavetas.flatMap((g, i) => (g !== null && g > 0 ? [i + 1] : []));
}

/** Mismas reglas que la base de datos, para avisar en el campo antes de enviar. Devuelve un mensaje por campo. */
export function validarRecepcion(f: FormRecepcion, c: ContextoValidacion): Errores {
  const e: Errores = {};
  const filas: ErroresFilas = { gavetas: {}, lecturas: {}, almacenamiento: {} };

  // ---- Sección 1
  if (!f.fecha_llegada) e.fecha_llegada = 'La fecha de llegada es obligatoria.';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha_llegada)) e.fecha_llegada = 'La fecha no es válida.';
  else if (f.fecha_llegada > c.hoy) e.fecha_llegada = 'La fecha de llegada no puede ser futura.';

  if (!f.guia_remision.trim()) e.guia_remision = 'La guía de remisión es obligatoria.';

  const lote = f.lote_id.trim();
  if (!lote) e.lote_id = 'El lote es obligatorio.';
  else if (!loteValido(lote, c.formatoLote)) e.lote_id = 'El formato no es válido. Son 3 grupos separados por guion, por ejemplo 123-456-789 o 123-456A-789.';
  else if (c.loteCerrado) e.lote_id = `El lote ${lote} ya está cerrado: no admite más camiones. Un administrador puede reabrirlo.`;

  if (!f.especie.trim()) e.especie = 'La especie es obligatoria.';
  if (c.loteExiste !== true && !f.proveedor.trim()) e.proveedor = 'El proveedor es obligatorio cuando el lote es nuevo.';

  const n = f.num_gavetas_bines.trim();
  if (!n) e.num_gavetas_bines = `Indica cuántos ${f.llegada_en} llegaron.`;
  else if (!/^\d+$/.test(n) || Number(n) < 1) e.num_gavetas_bines = 'Debe ser un número entero de 1 o más.';
  else if (Number(n) > 9999) e.num_gavetas_bines = 'El número es demasiado grande.';

  if (f.libras_reportadas !== null && f.libras_reportadas <= 0) e.libras_reportadas = 'Debe ser mayor que cero.';
  if (f.libras_planta !== null && f.libras_planta <= 0) e.libras_planta = 'Debe ser mayor que cero.';
  // Las libras no pueden ser menores que el peso total de las gavetas registradas.
  const totalGavetas = totalPesos(f.gavetas);
  const enUnidad = c.pesoTexto ?? ((lb: number) => `${lb.toFixed(2)} lb`);
  if (!e.libras_reportadas && f.libras_reportadas !== null && f.libras_reportadas < totalGavetas) {
    e.libras_reportadas = `No puede ser menor que el peso total de las gavetas (${enUnidad(totalGavetas)}).`;
  }
  if (!e.libras_planta && f.libras_planta !== null && f.libras_planta < totalGavetas) {
    e.libras_planta = `No puede ser menor que el peso total de las gavetas (${enUnidad(totalGavetas)}).`;
  }

  if (f.hora_inicio_descarga && f.hora_fin_descarga && f.hora_fin_descarga < f.hora_inicio_descarga) {
    e.hora_fin_descarga = 'La hora de fin no puede ser anterior a la de inicio.';
  }
  if (f.observacion.length > 2000) e.observacion = 'La observación no puede superar los 2000 caracteres.';

  // ---- Sección 2: gavetas
  f.gavetas.slice(0, NUM_GAVETAS_MAX).forEach((g, i) => {
    if (g !== null && g <= 0) filas.gavetas[i] = 'Debe ser mayor que cero.';
  });

  // ---- Sección 4: almacenamiento (se valida antes que las lecturas, que dependen de sus bines)
  const usadas = f.almacenamiento.map((fila, i) => ({ fila, i })).filter(({ fila }) => filaEnUso(fila));
  const vistosBin = new Map<string, number>();
  const vistosSelloRec = new Map<string, number>();
  const vistosSelloAlm = new Map<string, number>();
  for (const { fila, i } of usadas) {
    const fe: Partial<Record<keyof AlmacenamientoForm, string>> = {};
    const bin = fila.num_bin.trim();
    if (!bin) fe.num_bin = 'Escribe el número de bin.';
    else if (vistosBin.has(normalizar(bin))) fe.num_bin = `El bin ${bin} está repetido (fila ${vistosBin.get(normalizar(bin))! + 1}).`;
    else vistosBin.set(normalizar(bin), i);

    const sr = fila.sellos_recepcion.trim();
    if (sr) {
      if (vistosSelloRec.has(normalizar(sr))) fe.sellos_recepcion = `El sello ${sr} está repetido (fila ${vistosSelloRec.get(normalizar(sr))! + 1}).`;
      else vistosSelloRec.set(normalizar(sr), i);
    }
    const sa = fila.sellos_almacenamiento.trim();
    if (sa) {
      if (vistosSelloAlm.has(normalizar(sa))) fe.sellos_almacenamiento = `El sello ${sa} está repetido (fila ${vistosSelloAlm.get(normalizar(sa))! + 1}).`;
      else vistosSelloAlm.set(normalizar(sa), i);
    }
    if (fila.temperatura_c !== null && (fila.temperatura_c < TEMPERATURA_MIN || fila.temperatura_c > TEMPERATURA_MAX)) {
      fe.temperatura_c = `Revisa la temperatura: debe estar entre ${TEMPERATURA_MIN} y ${TEMPERATURA_MAX} °C.`;
    }
    if (fila.libras_aprox !== null && fila.libras_aprox <= 0) fe.libras_aprox = 'Debe ser mayor que cero.';
    if (Object.keys(fe).length > 0) filas.almacenamiento[i] = fe;
  }

  // ---- Sección 3: temperaturas por gaveta (una por gaveta, y la gaveta debe tener peso)
  const conPeso = new Set(gavetasConPeso(f.gavetas));
  const vistasGaveta = new Map<number, number>();
  f.temperaturas.slice(0, MAX_LECTURAS).forEach((l, i) => {
    const le: { num_gaveta?: string; temperatura_c?: string } = {};
    const tieneGaveta = l.num_gaveta !== null;
    const tieneTemp = l.temperatura_c !== null;
    if (tieneGaveta && !tieneTemp) le.temperatura_c = 'Falta la temperatura de esta gaveta.';
    if (!tieneGaveta && tieneTemp) le.num_gaveta = 'Elige a qué gaveta corresponde esta temperatura.';
    if (tieneGaveta) {
      if (!conPeso.has(l.num_gaveta!)) le.num_gaveta = `La gaveta ${l.num_gaveta} no tiene peso registrado. Elige otra o pesa esa gaveta.`;
      else if (vistasGaveta.has(l.num_gaveta!)) le.num_gaveta = `La gaveta ${l.num_gaveta} ya tiene temperatura en la fila ${vistasGaveta.get(l.num_gaveta!)! + 1}.`;
      else vistasGaveta.set(l.num_gaveta!, i);
    }
    if (tieneTemp && (l.temperatura_c! < TEMPERATURA_MIN || l.temperatura_c! > TEMPERATURA_MAX)) {
      le.temperatura_c = `Revisa la temperatura: debe estar entre ${TEMPERATURA_MIN} y ${TEMPERATURA_MAX} °C.`;
    }
    if (Object.keys(le).length > 0) filas.lecturas[i] = le;
  });

  // ---- Cierre
  if (c.cerrando) {
    if (f.libras_reportadas === null && !e.libras_reportadas) e.libras_reportadas = 'Para cerrar indica las libras reportadas.';
    if (f.libras_planta === null && !e.libras_planta) e.libras_planta = 'Para cerrar indica las libras de planta.';
    if (f.gavetas.every((g) => g === null)) e.gavetas = 'Para cerrar la recepción registra el peso de al menos una gaveta.';
  }

  if (Object.keys(filas.gavetas).length || Object.keys(filas.lecturas).length || Object.keys(filas.almacenamiento).length) e.filas = filas;
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
    llegada_en: f.llegada_en,
    num_gavetas_bines: Number(f.num_gavetas_bines),
    libras_reportadas: f.libras_reportadas,
    libras_planta: f.libras_planta,
    hora_inicio_descarga: texto(f.hora_inicio_descarga),
    hora_fin_descarga: texto(f.hora_fin_descarga),
    observacion: texto(f.observacion),
    gavetas: f.gavetas.flatMap((peso, i) => (peso === null ? [] : [{ num_gaveta: i + 1, peso_lb: peso }])),
    temperaturas: f.temperaturas.flatMap((l, i) =>
      l.num_gaveta !== null && l.temperatura_c !== null ? [{ lectura_id: i + 1, num_gaveta: l.num_gaveta, temperatura_c: l.temperatura_c }] : []),
    almacenamiento: f.almacenamiento.filter(filaEnUso).map((a) => ({
      num_bin: a.num_bin.trim(), sellos_recepcion: a.sellos_recepcion.trim(), sellos_almacenamiento: a.sellos_almacenamiento.trim(),
      temperatura_c: a.temperatura_c, libras_aprox: a.libras_aprox,
    })),
  };
  // El proveedor solo se envía si el lote es nuevo: en un lote existente lo manda la base de datos.
  if (extra.loteExiste !== true) p.proveedor = f.proveedor.trim();
  // Solo al guardar y cerrar se puede cerrar el lote (un borrador nunca lo cierra).
  if (extra.estado === 'cerrado' && f.cerrar_lote) p.cerrar_lote = true;
  if (extra.recepcion_id) { p.recepcion_id = extra.recepcion_id; p.version = extra.version; }
  return p;
}

export type Seccion = 'datos' | 'gavetas' | 'temperaturas' | 'almacenamiento' | 'cierre';

/** Cuántos errores hay en cada sección, para marcarlos en la navegación. */
export function erroresPorSeccion(e: Errores): Record<Seccion, number> {
  const r: Record<Seccion, number> = { datos: 0, gavetas: 0, temperaturas: 0, almacenamiento: 0, cierre: 0 };
  const datos = ['fecha_llegada', 'placa_vehiculo', 'lote_id', 'proveedor', 'especie', 'piscina', 'guia_remision', 'num_gavetas_bines',
    'libras_reportadas', 'libras_planta', 'hora_inicio_descarga', 'hora_fin_descarga'] as const;
  for (const k of datos) if (e[k]) r.datos++;
  if (e.observacion) r.cierre++;
  if (e.gavetas) r.gavetas++;
  r.gavetas += Object.keys(e.filas?.gavetas ?? {}).length;
  r.temperaturas += Object.keys(e.filas?.lecturas ?? {}).length;
  r.almacenamiento += Object.keys(e.filas?.almacenamiento ?? {}).length;
  return r;
}
