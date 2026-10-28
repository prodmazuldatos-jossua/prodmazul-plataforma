// Lógica pura de la pantalla Usuarios (sin pantalla): textos del historial y reglas de la contraseña.
import type { EventoUsuario } from './api';

export const CLAVE_MINIMA = 10;
export const CLAVE_MAXIMA = 72;
/** Segundos que una contraseña temporal permanece a la vista en la pantalla. */
export const SEGUNDOS_CLAVE_VISIBLE = 120;

export function errorClave(clave: string): string | null {
  if (clave.length < CLAVE_MINIMA) return `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`;
  if (new TextEncoder().encode(clave).length > CLAVE_MAXIMA) return `La contraseña es demasiado larga (máximo ${CLAVE_MAXIMA} caracteres).`;
  if (clave.trim() !== clave) return 'La contraseña no puede empezar ni terminar con espacios.';
  return null;
}

const nombreModulo = (id: string) => { const m = /^M0*(\d+)$/.exec(id); return m ? `Módulo ${m[1]}` : id; };
const rolesTexto = (v: unknown): string => {
  if (!v || typeof v !== 'object') return 'sin acceso';
  const e = Object.entries(v as Record<string, string>);
  return e.length === 0 ? 'sin acceso' : e.map(([m, r]) => `${nombreModulo(m)}: ${r}`).join(', ');
};

/** Frase en español para un evento del historial. Nunca incluye contraseñas (no existen en los datos). */
export function textoEvento(e: Pick<EventoUsuario, 'accion' | 'usuario' | 'usuario_correo' | 'detalle'>): string {
  const quien = e.usuario || e.usuario_correo || 'un usuario';
  const d = e.detalle ?? {};
  switch (e.accion) {
    case 'crear_usuario': return `Creó a ${quien}.`;
    case 'cambiar_nombre_usuario': return `Cambió el nombre de «${String(d.antes ?? '')}» a «${String(d.despues ?? '')}».`;
    case 'cambiar_roles_usuario': return `Cambió el acceso de ${quien}: de ${rolesTexto(d.antes)} a ${rolesTexto(d.despues)}.`;
    case 'desactivar_usuario': return `Desactivó a ${quien}.`;
    case 'reactivar_usuario': return `Reactivó a ${quien}.`;
    case 'cambiar_clave_usuario': return `Cambió la contraseña de ${quien}.`;
    case 'actualizar_usuario': return `Guardó a ${quien} sin cambios.`;
    default: return `${e.accion} (${quien}).`;
  }
}

/** Qué dice el botón «Comprobar función» según lo que respondió el servidor. */
export function textoVersionFuncion(version: string | null | undefined, error?: string): { tipo: 'exito' | 'aviso' | 'error'; texto: string } {
  if (error) {
    if (/no reconocida/i.test(error)) return { tipo: 'aviso', texto: 'La gestión de usuarios está desactualizada. Avisa al responsable técnico.' };
    return { tipo: 'error', texto: error };
  }
  if (!version) return { tipo: 'aviso', texto: 'La función respondió, pero no informó su versión.' };
  return { tipo: 'exito', texto: `La función de usuarios está instalada y responde: versión ${version}.` };
}
