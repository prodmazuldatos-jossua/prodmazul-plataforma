import { supabase } from '../../lib/supabase';
import { aApiError } from '../../lib/errores';

export type TipoParametro = 'entero' | 'decimal' | 'regex';
export interface ParametroConfig {
  clave: string; etiqueta: string; ayuda: string; tipo: TipoParametro;
  min?: number; max?: number; defecto: number | string; valor: number | string;
  cambiado_en: string | null; cambiado_por: string | null;
}
export async function listarConfig(): Promise<ParametroConfig[]> {
  const { data, error } = await supabase.rpc('api_admin_config_listar');
  if (error) throw aApiError(error);
  return (data as { parametros: ParametroConfig[] }).parametros;
}
export async function cambiarConfig(clave: string, valor: number | string): Promise<{ cambio: boolean }> {
  const { data, error } = await supabase.rpc('api_admin_config_cambiar', { p_clave: clave, p_valor: valor });
  if (error) throw aApiError(error);
  return data as { cambio: boolean };
}

export interface FiltrosAuditoria { desde: string; hasta: string; usuario: string; modulo: string; accion: string; texto: string }
export interface FilaAuditoria {
  evento_id: number; creado_en: string; quien_id: string | null; quien: string | null; modulo: string | null;
  accion: string; entidad: string | null; entidad_id: string | null; resultado: string; detalle: Record<string, unknown>;
}
export interface ListaAuditoria {
  total: number; pagina: number; por_pagina: number; filas: FilaAuditoria[];
  opciones: { usuarios: { id: string; nombre: string }[]; modulos: string[]; acciones: string[] };
}
export async function consultarAuditoria(p: Record<string, unknown>): Promise<ListaAuditoria> {
  const { data, error } = await supabase.rpc('api_admin_auditoria', { p });
  if (error) throw aApiError(error);
  return data as ListaAuditoria;
}

export interface LoteAdmin {
  lote_id: string; cerrado: boolean; cerrado_en: string | null; cerrado_por: string | null;
  proveedor: string; especie: string | null; camiones: number; libras_planta: number;
}
export type EstadoLotes = 'cerrados' | 'abiertos' | 'todos';
export interface ListaLotes { total: number; pagina: number; por_pagina: number; lotes: LoteAdmin[] }
export async function listarLotes(p: { estado: EstadoLotes; busqueda: string; pagina: number }): Promise<ListaLotes> {
  const { data, error } = await supabase.rpc('api_admin_lotes', { p });
  if (error) throw aApiError(error);
  return data as ListaLotes;
}
export async function reabrirLote(lote: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc('api_m01_reabrir_lote', { p_lote: lote, p_motivo: motivo });
  if (error) throw aApiError(error);
}

export type TipoCatalogo = 'proveedores' | 'especies';
export interface ItemCatalogo {
  id: string; nombre: string; activo: boolean; recepciones: number; lotes: number;
  ultima_recepcion: string | null; parecidos: number; grupo: string | null;
  /** true si tiene alguna recepción (de cualquier estado) o algún lote: no se puede eliminar. */
  en_uso?: boolean;
}
export interface Catalogo { tipo: TipoCatalogo; total: number; items: ItemCatalogo[] }
export async function listarCatalogo(p: { tipo: TipoCatalogo; busqueda: string; solo_parecidos: boolean }): Promise<Catalogo> {
  const { data, error } = await supabase.rpc('api_admin_catalogo', { p });
  if (error) throw aApiError(error);
  return data as Catalogo;
}
export interface ResultadoRenombrar { id: string; nombre: string; antes?: string; sin_cambios?: boolean }
/** Cambia el nombre de un proveedor o una especie. Las recepciones y los lotes lo muestran con el nombre nuevo. */
export async function renombrarCatalogo(tipo: TipoCatalogo, id: string, nombre: string): Promise<ResultadoRenombrar> {
  const { data, error } = await supabase.rpc('api_admin_catalogo_renombrar', { p_tipo: tipo, p_id: id, p_nombre: nombre });
  if (error) throw aApiError(error);
  return data as ResultadoRenombrar;
}
/** Elimina un proveedor o una especie que no está en ninguna recepción. */
export async function eliminarCatalogo(tipo: TipoCatalogo, id: string): Promise<{ id: string; nombre: string }> {
  const { data, error } = await supabase.rpc('api_admin_catalogo_eliminar', { p_tipo: tipo, p_id: id });
  if (error) throw aApiError(error);
  return data as { id: string; nombre: string };
}

export interface ResultadoCrearCatalogo { id: string; nombre: string; tipo: TipoCatalogo }
/** Crea a mano un proveedor o una especie (solo el nombre). */
export async function crearCatalogo(tipo: TipoCatalogo, nombre: string): Promise<ResultadoCrearCatalogo> {
  const { data, error } = await supabase.rpc('api_admin_catalogo_crear', { p_tipo: tipo, p_nombre: nombre });
  if (error) throw aApiError(error);
  return data as ResultadoCrearCatalogo;
}
