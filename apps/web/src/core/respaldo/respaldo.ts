// Lógica pura del indicador de respaldo (sin pantalla): textos, niveles y explicación de errores.
// Las reglas del aviso salen del servidor (api_respaldo_resumen); aquí solo se muestran y se mantienen al día
// mientras pasa el tiempo (para que «hace 5 minutos» avance solo y el aviso rojo no dependa del reloj del dispositivo).

export type Nivel = 'ok' | 'aviso' | 'alerta' | 'apagada';

export interface CorridaResumen { origen: string; pedida_en: string; terminada_en: string | null; estado: string; error: string | null }

export interface ResumenRespaldo {
  ahora: string;
  activa: boolean;
  nivel: Nivel;
  alerta: boolean;
  motivos: { codigo: string; texto: string }[];
  limite_horas: number;
  ultima_sync_ok_en: string | null;
  segundos_sin_sincronizar: number | null;
  ultimo_intento_en: string | null;
  pendientes: number;
  con_error: number;
  agotadas: number;
  fotos_sin_respaldo: number;
  fotos_mas_antigua_en: string | null;
  fotos_con_error: number;
  fotos_agotadas: number;
  purga_activa: boolean;
  purga_con_error: number;
  purga_agotadas: number;
  ultima_corrida: CorridaResumen | null;
  ultima_purga: CorridaResumen | null;
  problemas: number;
}

export interface ErrorCola { tabla: string; clave: string; operacion: string; intentos: number; agotado: boolean; ultimo_error: string | null; cambiado_en: string; proximo_intento_en: string | null }
export interface ErrorFoto { foto_id: string; recepcion_id: string; intentos: number; agotada: boolean; ultimo_error: string | null; proximo_intento_en: string | null; actualizado_en: string }
export interface CorridaConError { tipo: 'sincronizacion' | 'purga'; id: number; origen: string; pedida_en: string; terminada_en: string | null; estado: string; error: string | null }
export interface ErroresRespaldo {
  ahora: string;
  maximo_intentos: number;
  datos: { total: number; items: ErrorCola[] };
  fotos: { total: number; items: ErrorFoto[] };
  purga: { total: number; items: ErrorFoto[] };
  corridas: CorridaConError[];
  ultimo_error: { texto: string; en: string } | null;
}

/** «hace 5 minutos», «hace 2 h 15 min», «hace 3 días». */
export function textoHace(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  if (s < 60) return 'hace menos de 1 minuto';
  const min = Math.floor(s / 60);
  if (min < 60) return min === 1 ? 'hace 1 minuto' : `hace ${min} minutos`;
  const h = Math.floor(min / 60);
  if (h < 48) {
    const resto = min % 60;
    return resto === 0 ? `hace ${h} ${h === 1 ? 'hora' : 'horas'}` : `hace ${h} h ${resto} min`;
  }
  const d = Math.floor(h / 24);
  return `hace ${d} días`;
}

/** Segundos desde la última sincronización, avanzando con el reloj del dispositivo SOLO por el tiempo transcurrido desde que llegó el dato. */
export function segundosDesde(r: ResumenRespaldo, recibidoMs: number, ahoraMs: number): number | null {
  if (r.segundos_sin_sincronizar == null) return null;
  return r.segundos_sin_sincronizar + Math.max(0, (ahoraMs - recibidoMs) / 1000);
}

/** Nivel mostrado: el del servidor, pero si pasa el tiempo sin recibir datos nuevos (sin señal) el aviso rojo puede aparecer solo. */
export function nivelActual(r: ResumenRespaldo, recibidoMs: number, ahoraMs: number): Nivel {
  if (!r.activa) return 'apagada';
  const seg = segundosDesde(r, recibidoMs, ahoraMs);
  if (r.alerta || seg == null || seg > r.limite_horas * 3600) return 'alerta';
  return r.problemas > 0 ? 'aviso' : 'ok';
}

export function textoIndicador(r: ResumenRespaldo, recibidoMs: number, ahoraMs: number): string {
  if (!r.activa) return 'Respaldo: apagado';
  const seg = segundosDesde(r, recibidoMs, ahoraMs);
  return seg == null ? 'Respaldo: sin sincronizar' : `Respaldo: ${textoHace(seg)}`;
}

/** Frases del aviso rojo; si el aviso apareció solo por el paso del tiempo, se explica igual. */
export function motivosAlerta(r: ResumenRespaldo, recibidoMs: number, ahoraMs: number): string[] {
  if (!r.activa) return [];
  const textos = r.motivos.map((m) => m.texto);
  const seg = segundosDesde(r, recibidoMs, ahoraMs);
  if (textos.length === 0 && seg != null && seg > r.limite_horas * 3600) {
    textos.push(`Hace más de ${r.limite_horas} horas que los datos no se respaldan en Google Sheets.`);
  }
  return textos;
}

export interface Explicacion { titulo: string; ayuda: string }

function plano(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Traduce el texto técnico de un error a una explicación y una acción para quien administra. */
export function explicarError(texto: string | null | undefined): Explicacion {
  const t = plano(texto ?? '');
  if (!t) return { titulo: 'Sin detalle', ayuda: 'No quedó el motivo. Pulsa «Reintentar errores» y vuelve a mirar en unos minutos.' };
  if (t.includes('papelera')) return { titulo: 'La copia está en la papelera de Drive', ayuda: 'En Drive (cuenta DATOS) abre la Papelera, restaura el archivo y pulsa «Reintentar errores».' };
  if (t.includes('descripcion no coincide') || t.includes('no corresponde')) return { titulo: 'El archivo de Drive no es el de esta foto', ayuda: 'No lo borres. Avisa al responsable técnico para revisarlo antes de reintentar.' };
  if (t.includes('pesa') || t.includes('tamano distinto') || t.includes('tamano no valido')) return { titulo: 'El archivo no pesa lo mismo que la foto', ayuda: 'Reintenta. Si se repite, avisa al responsable técnico.' };
  if (t.includes('no se pudo abrir el archivo')) return { titulo: 'No se encontró el archivo en Drive', ayuda: 'Puede haberse borrado o movido. Revisa la carpeta de respaldo en Drive; si no está, avisa al responsable técnico.' };
  if (t.includes('no autorizado') || t.includes('token') || t.includes('falta el secreto') || t.includes('apps_script')) return { titulo: 'Falla de autorización con Google', ayuda: 'La copia en Google no pudo autorizarse. Avisa al responsable técnico para revisar la conexión.' };
  if (t.includes('restringido') || t.includes('permiso') || t.includes('carpeta')) return { titulo: 'Problema con la carpeta de Drive', ayuda: 'La carpeta de respaldo en Google Drive no está disponible o no tiene permiso. Avisa al responsable técnico.' };
  if (t.includes('invoked too many') || t.includes('cuota') || t.includes('quota') || t.includes('limite de uso') || t.includes('demasiadas')) return { titulo: 'Google pidió esperar', ayuda: 'Es un límite de uso de Google. Se reintenta solo; no hace falta hacer nada.' };
  if (t.includes('tiempo') || t.includes('alcanzo') || t.includes('timeout') || t.includes('a tiempo')) return { titulo: 'Google tardó demasiado', ayuda: 'Se reintenta solo en la siguiente corrida.' };
  if (t.includes('conect') || t.includes('conexion') || t.includes('fetch') || t.includes('red ') || /\b5\d\d\b/.test(t) || t.includes('respondio')) return { titulo: 'No hubo conexión con Google', ayuda: 'Se reintenta solo. Si dura más de unas horas, avisa al responsable técnico.' };
  return { titulo: 'Error sin clasificar', ayuda: 'Se reintenta solo. Si se repite varios días, copia el texto del detalle y avisa al responsable técnico.' };
}

/** Descripción corta de una corrida («Sincronización automática · con error»). */
export function textoEstadoCorrida(estado: string): string {
  switch (estado) {
    case 'ok': return 'correcta';
    case 'con_error': return 'con error';
    case 'sin_respuesta': return 'sin respuesta';
    case 'en_curso': return 'en curso';
    case 'pedida': return 'pedida';
    default: return estado;
  }
}
export const textoOrigen = (o: string) => (o === 'cron' ? 'automática' : o === 'manual' ? 'manual' : o);
