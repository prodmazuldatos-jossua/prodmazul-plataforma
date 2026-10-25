import { almacenIndexedDB } from './db';
import { Cola } from './cola';
import { guardarRecepcion } from '../modules/m01-recepcion/api';
import { subirFotoReanudable } from '../modules/m01-recepcion/fotos';

/** La cola real de este dispositivo: guarda en IndexedDB y envía a Supabase. */
export const cola = new Cola({
  almacen: almacenIndexedDB(),
  guardar: guardarRecepcion,
  subirFoto: subirFotoReanudable,
});

/**
 * Cuántos registros hay en este dispositivo sin enviar (de cualquier persona). Se usa para no cerrar la sesión
 * por inactividad y para avisar al cerrarla.
 */
export async function contarPendientes(): Promise<number> {
  try { return (await cola.contar()).total; } catch { return 0; }
}

/** Pide al navegador que no borre los datos de la aplicación si falta espacio (mejor esfuerzo; puede negarse). */
export async function protegerAlmacenamiento(): Promise<void> {
  try { await navigator.storage?.persist?.(); } catch { /* sin soporte */ }
}
