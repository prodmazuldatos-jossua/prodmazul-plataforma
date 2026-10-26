import { supabase } from '../../lib/supabase';
import { aApiError } from '../../lib/errores';

export interface RolUsuario { modulo_id: string; rol_id: string }
export interface UsuarioAdmin {
  user_id: string; correo: string; nombre: string; activo: boolean; es_admin_general: boolean;
  creado_en: string; ultimo_acceso: string | null; roles: RolUsuario[];
}
export interface ListaUsuarios {
  usuarios: UsuarioAdmin[];
  roles: { rol_id: string; nombre: string }[];
  modulos: { modulo_id: string; nombre: string }[];
}

export async function listarUsuarios(): Promise<ListaUsuarios> {
  const { data, error } = await supabase.rpc('api_admin_listar_usuarios');
  if (error) throw aApiError(error);
  return data as ListaUsuarios;
}

/** roles: un elemento por módulo; rol_id null = quitar el acceso a ese módulo. */
export async function actualizarUsuario(user: string, nombre: string, activo: boolean, roles: { modulo_id: string; rol_id: string | null }[]) {
  const { error } = await supabase.rpc('api_admin_actualizar_usuario', { p_user: user, p_nombre: nombre, p_activo: activo, p_roles: roles });
  if (error) throw aApiError(error);
}

/** Crear usuarios y cambiar contraseñas pasa por la función de servidor admin-usuarios (necesita la clave de servicio). */
async function llamarFuncion(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke('admin-usuarios', { body });
  if (error) {
    const estado = (error as { context?: { status?: number } }).context?.status;
    if (estado === 404) throw new Error('La función «admin-usuarios» todavía no está instalada en Supabase. Mira el manual, paso «Instalar la función de usuarios».');
    if (/failed to fetch|network|load failed/i.test(error.message)) throw new Error('No hay conexión. Inténtalo cuando tengas señal.');
    throw new Error('No se pudo completar la acción. Inténtalo de nuevo.');
  }
  const r = data as { ok?: boolean; error?: string } | null;
  if (!r?.ok) throw new Error(r?.error ?? 'No se pudo completar la acción.');
}

export const crearUsuario = (correo: string, nombre: string, clave: string, roles: { modulo_id: string; rol_id: string }[]) =>
  llamarFuncion({ accion: 'crear', correo, nombre, clave, roles });
export const cambiarClaveUsuario = (user: string, clave: string) => llamarFuncion({ accion: 'clave', user_id: user, clave });

/** Contraseña temporal de 12 caracteres, sin letras que se confunden (0/O, 1/l/I). */
export function generarClave(largo = 12): string {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(largo));
  return Array.from(bytes, (b) => letras[b % letras.length]).join('');
}
