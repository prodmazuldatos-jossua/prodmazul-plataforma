import { supabase } from '../../../lib/supabase';
import { aApiError } from '../../../lib/errores';
import type { Filtros, RespEspecie, RespPeriodos, RespProveedores } from './reportes';

async function llamar<T>(funcion: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(funcion, args);
  if (error) throw aApiError(error);
  return data as T;
}

export const obtenerPeriodos = (f: Filtros) =>
  llamar<RespPeriodos>('api_m01_rep_periodos', { p_desde: f.desde, p_hasta: f.hasta, p_periodo: f.periodo, p_borradores: f.borradores });
export const obtenerProveedores = (f: Filtros) =>
  llamar<RespProveedores>('api_m01_rep_proveedores', { p_desde: f.desde, p_hasta: f.hasta, p_borradores: f.borradores });
export const obtenerEspecieProveedor = (f: Filtros) =>
  llamar<RespEspecie>('api_m01_rep_especie_proveedor', { p_desde: f.desde, p_hasta: f.hasta, p_borradores: f.borradores });
