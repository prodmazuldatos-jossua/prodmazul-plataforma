import { supabase } from '../../lib/supabase';
import { aApiError } from '../../lib/errores';
import type { ConfigPublica, InfoLote, ItemCatalogo, RespuestaGuardar } from './tipos';

async function llamar<T>(funcion: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(funcion, args);
  if (error) throw aApiError(error);
  return data as T;
}

export const obtenerConfig = () => llamar<ConfigPublica>('api_config_publica');

export const listarCatalogo = (tipo: 'proveedores' | 'especies' | 'lotes', busqueda: string) =>
  llamar<ItemCatalogo[]>('api_listar_catalogo', { p_tipo: tipo, p_busqueda: busqueda });

export const obtenerLote = (lote: string) => llamar<InfoLote>('api_obtener_lote', { p_lote: lote });

export const guardarRecepcion = (p: Record<string, unknown>) => llamar<RespuestaGuardar>('api_m01_guardar_recepcion', { p });
