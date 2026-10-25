import { supabase } from '../../lib/supabase';
import { aApiError } from '../../lib/errores';
import type { ConfigPublica, FiltrosListado, InfoLote, ItemCatalogo, RecepcionDetalle, RespuestaEstado, RespuestaGuardar, RespuestaListado } from './tipos';

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

export const listarRecepciones = (f: FiltrosListado) =>
  llamar<RespuestaListado>('api_m01_listar_recepciones', {
    p: {
      busqueda: f.busqueda.trim(), estado: f.estado, desde: f.desde || null, hasta: f.hasta || null,
      limite: f.limite, desplazamiento: f.desplazamiento,
    },
  });

export const obtenerRecepcion = (id: string) => llamar<RecepcionDetalle>('api_m01_obtener_recepcion', { p_id: id });

export const anularRecepcion = (id: string, motivo: string, version: number) =>
  llamar<RespuestaEstado>('api_m01_anular', { p_id: id, p_motivo: motivo, p_version: version });
export const eliminarRecepcion = (id: string, motivo: string, version: number) =>
  llamar<RespuestaEstado>('api_m01_eliminar', { p_id: id, p_motivo: motivo, p_version: version });
export const reactivarRecepcion = (id: string, version: number) =>
  llamar<RespuestaEstado>('api_m01_reactivar', { p_id: id, p_version: version });
