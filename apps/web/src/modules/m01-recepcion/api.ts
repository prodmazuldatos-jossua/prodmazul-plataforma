import { supabase } from '../../lib/supabase';
import { aApiError } from '../../lib/errores';
import type { ConfigPublica, FiltrosListado, FotoRemota, InfoLote, ItemCatalogo, RecepcionDetalle, RespuestaEstado, RespuestaGuardar, RespuestaListado, RespuestaRegistroFoto } from './tipos';

async function llamar<T>(funcion: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(funcion, args);
  if (error) throw aApiError(error);
  return data as T;
}

export const obtenerConfig = () => llamar<ConfigPublica>('api_config_publica');

export const listarCatalogo = (tipo: 'proveedores' | 'especies' | 'lotes', busqueda: string) =>
  llamar<ItemCatalogo[]>('api_listar_catalogo', { p_tipo: tipo, p_busqueda: busqueda });

export const obtenerLote = (lote: string) => llamar<InfoLote>('api_obtener_lote', { p_lote: lote });

/** Segundos que se espera la respuesta al guardar antes de darla por perdida (se trata como falta de conexión). */
export const ESPERA_GUARDAR_MS = 30_000;

/**
 * Guarda una recepción. Si en ESPERA_GUARDAR_MS no hay respuesta, se corta y se trata como «sin conexión»:
 * la recepción pudo haber llegado al servidor, pero reenviar el mismo client_uuid no la duplica.
 */
export async function guardarRecepcion(p: Record<string, unknown>, esperaMs = ESPERA_GUARDAR_MS): Promise<RespuestaGuardar> {
  const { data, error } = await supabase.rpc('api_m01_guardar_recepcion', { p }).abortSignal(AbortSignal.timeout(esperaMs));
  if (error) throw aApiError(error);
  return data as RespuestaGuardar;
}

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
export const devolverABorrador = (id: string, motivo: string, version: number) =>
  llamar<RespuestaEstado>('api_m01_devolver_a_borrador', { p_id: id, p_motivo: motivo, p_version: version });

export const reactivarRecepcion = (id: string, version: number) =>
  llamar<RespuestaEstado>('api_m01_reactivar', { p_id: id, p_version: version });

export const registrarFoto = (recepcionId: string, nombre: string, tipo: string, tamano: number) =>
  llamar<RespuestaRegistroFoto>('api_m01_registrar_foto', { p_recepcion_id: recepcionId, p_nombre: nombre, p_tipo_mime: tipo, p_tamano: tamano });
export const confirmarFoto = (fotoId: string) => llamar<{ foto_id: string; confirmada: boolean }>('api_m01_confirmar_foto', { p_foto_id: fotoId });
export const eliminarFotoDb = (fotoId: string) => llamar<{ eliminada: boolean }>('api_m01_eliminar_foto', { p_foto_id: fotoId });
export const fotosDeRecepcion = (recepcionId: string) => llamar<FotoRemota[]>('api_m01_fotos_recepcion', { p_recepcion_id: recepcionId });
