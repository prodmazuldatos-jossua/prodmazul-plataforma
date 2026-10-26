import { supabase } from '../../lib/supabase';
import { aApiError } from '../../lib/errores';
import type { ErroresRespaldo, ResumenRespaldo } from './respaldo';

export async function obtenerResumen(): Promise<ResumenRespaldo> {
  const { data, error } = await supabase.rpc('api_respaldo_resumen');
  if (error) throw aApiError(error);
  return data as ResumenRespaldo;
}

export async function obtenerErrores(n = 50): Promise<ErroresRespaldo> {
  const { data, error } = await supabase.rpc('api_respaldo_errores', { p_n: n });
  if (error) throw aApiError(error);
  return data as ErroresRespaldo;
}

/** Pide una sincronización ahora (el trabajo lo hace el servidor; tarda alrededor de un minuto). */
export async function respaldarAhora(): Promise<void> {
  const { error } = await supabase.rpc('api_sync_ahora');
  if (error) throw aApiError(error);
}

/** Quita las esperas de lo que falló para que se vuelva a intentar en la próxima corrida. */
export async function reintentarErrores(): Promise<{ filas: number; fotos: number }> {
  const { data, error } = await supabase.rpc('api_sync_reintentar_errores');
  if (error) throw aApiError(error);
  return data as { filas: number; fotos: number };
}
