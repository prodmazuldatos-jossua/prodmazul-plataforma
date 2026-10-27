// Lógica de la función «admin-usuarios» (versión 2). No usa Deno ni Supabase directamente: recibe «dependencias»
// (index.ts las conecta a Supabase; las pruebas usan dobles). Así se puede probar todo sin internet.
//
// Reglas que se cumplen aquí:
//  - Solo el administrador general activo puede usarla (se comprueba en el servidor, nunca en la pantalla).
//  - Se valida TODO antes de tocar Supabase Auth (no se crean cuentas para después deshacerlas por un dato mal escrito).
//  - La contraseña nunca se devuelve, nunca se escribe en el registro de la función ni llega a la base de datos de la aplicación.
//  - Si el alta falla a medias, se borra la cuenta creada (no queda un usuario a medias).

export const VERSION = '2.0';
export const CLAVE_MINIMA = 10;
export const CLAVE_MAXIMA = 72; // Supabase Auth no admite contraseñas más largas
export const NOMBRE_MAXIMO = 60;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Respuesta = { ok: true; [k: string]: unknown } | { ok: false; error: string };
export interface Rol { modulo_id: string; rol_id: string }

export interface Dependencias {
  /** Quién llama, según su sesión (null si la sesión no es válida). */
  sesion(token: string): Promise<{ id: string } | null>;
  /** Perfil de esa sesión (api_mi_perfil). */
  perfil(token: string): Promise<{ es_admin_general?: boolean; activo?: boolean } | null>;
  crearCuenta(correo: string, clave: string): Promise<{ id: string } | { error: 'existe' | 'otro' }>;
  borrarCuenta(id: string): Promise<void>;
  cambiarClave(id: string, clave: string): Promise<boolean>;
  existePerfil(id: string): Promise<boolean>;
  /** Llama a una función de la base con la clave de servicio. Devuelve el mensaje de error, si lo hay. */
  rpc(nombre: 'adm_registrar_usuario' | 'adm_auditar_clave', args: Record<string, unknown>): Promise<{ error?: string }>;
  /** Registro de la función: solo se escribe la acción y el resultado, nunca datos de la solicitud. */
  log(linea: string): void;
}

const fallo = (error: string): Respuesta => ({ ok: false, error });
const texto = (v: unknown) => (typeof v === 'string' ? v : '');
const limpiarNombre = (v: unknown) => texto(v).replace(/\s+/g, ' ').trim();
const bytes = (t: string) => new TextEncoder().encode(t).length;

export function validarClave(clave: string, correo?: string): string | null {
  if (clave.length < CLAVE_MINIMA) return `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`;
  if (bytes(clave) > CLAVE_MAXIMA) return `La contraseña es demasiado larga (máximo ${CLAVE_MAXIMA} caracteres).`;
  if (clave.trim() !== clave) return 'La contraseña no puede empezar ni terminar con espacios.';
  if (correo && clave.toLowerCase() === correo.toLowerCase()) return 'La contraseña no puede ser igual al correo.';
  return null;
}

export function validarRoles(v: unknown): { roles: Rol[] } | { error: string } {
  if (v === undefined || v === null) return { roles: [] };
  if (!Array.isArray(v) || v.length > 30) return { error: 'Los roles no son válidos.' };
  const roles: Rol[] = [];
  for (const r of v) {
    const m = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
    const modulo_id = texto(m.modulo_id).trim();
    const rol_id = texto(m.rol_id).trim();
    if (!modulo_id || !rol_id || modulo_id.length > 40 || rol_id.length > 40) return { error: 'Los roles no son válidos.' };
    if (roles.some((x) => x.modulo_id === modulo_id)) return { error: 'Un módulo no puede tener dos roles.' };
    roles.push({ modulo_id, rol_id });
  }
  return { roles };
}

export async function procesar(autorizacion: string, cuerpo: unknown, d: Dependencias): Promise<Respuesta> {
  const token = autorizacion.trim();
  if (!token) return fallo('Sesión no válida. Vuelve a iniciar sesión.');

  // 1) Quién llama: administrador general activo.
  const s = await d.sesion(token).catch(() => null);
  if (!s) return fallo('Sesión no válida. Vuelve a iniciar sesión.');
  const p = await d.perfil(token).catch(() => null);
  if (!p || p.es_admin_general !== true || p.activo === false) {
    d.log('rechazado: no es administrador general');
    return fallo('Solo el administrador general puede hacer esto.');
  }
  const admin = s.id;

  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return fallo('Solicitud no válida.');
  const c = cuerpo as Record<string, unknown>;

  // 2) Acciones.
  if (c.accion === 'version') {
    d.log('version');
    return { ok: true, version: VERSION, acciones: ['crear', 'clave', 'version'] };
  }

  if (c.accion === 'crear') {
    const correo = texto(c.correo).trim().toLowerCase();
    const nombre = limpiarNombre(c.nombre);
    const clave = texto(c.clave);
    if (!CORREO.test(correo) || correo.length > 254) return fallo('El correo no es válido.');
    if (!nombre || nombre.length > NOMBRE_MAXIMO) return fallo(`El nombre es obligatorio (máximo ${NOMBRE_MAXIMO} caracteres).`);
    const ec = validarClave(clave, correo);
    if (ec) return fallo(ec);
    const vr = validarRoles(c.roles);
    if ('error' in vr) return fallo(vr.error);

    const nueva = await d.crearCuenta(correo, clave);
    if ('error' in nueva) {
      d.log('crear: no se pudo crear la cuenta');
      return fallo(nueva.error === 'existe' ? 'Ya existe un usuario con ese correo.' : 'No se pudo crear el usuario.');
    }
    const r = await d.rpc('adm_registrar_usuario', { p_user: nueva.id, p_nombre: nombre, p_roles: vr.roles, p_admin: admin });
    if (r.error) {
      await d.borrarCuenta(nueva.id).catch(() => undefined); // deshace: no queda un usuario a medias
      d.log('crear: deshecho por error al registrar');
      return fallo(r.error.includes('|') ? r.error.split('|')[1] : 'No se pudo registrar el usuario.');
    }
    d.log('crear: ok');
    return { ok: true, user_id: nueva.id };
  }

  if (c.accion === 'clave') {
    const objetivo = texto(c.user_id);
    const clave = texto(c.clave);
    if (!UUID.test(objetivo)) return fallo('Usuario no válido.');
    const ec = validarClave(clave);
    if (ec) return fallo(ec);
    if (!(await d.existePerfil(objetivo).catch(() => false))) return fallo('El usuario no existe.');
    if (!(await d.cambiarClave(objetivo, clave))) {
      d.log('clave: no se pudo cambiar');
      return fallo('No se pudo cambiar la contraseña.');
    }
    const a = await d.rpc('adm_auditar_clave', { p_user: objetivo, p_admin: admin }); // constancia: quién y a quién; nunca la clave
    d.log(a.error ? 'clave: ok (sin constancia)' : 'clave: ok');
    return a.error
      ? { ok: true, aviso: 'La contraseña se cambió, pero no se pudo dejar constancia en la auditoría. Avísalo al soporte.' }
      : { ok: true };
  }

  return fallo('Acción no reconocida.');
}
