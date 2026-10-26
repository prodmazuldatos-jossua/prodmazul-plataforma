// Función de servidor para que el administrador general cree usuarios y cambie contraseñas.
// Despliegue: supabase functions deploy admin-usuarios --no-verify-jwt
// (la verificación del solicitante se hace aquí dentro). Usa las variables que Supabase ya entrega:
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY. No pegues claves en el código.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (cuerpo: Record<string, unknown>) =>
  new Response(JSON.stringify(cuerpo), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fallo = (error: string) => responder({ ok: false, error });

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLAVE_MINIMA = 10;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fallo('Método no permitido.');

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const token = req.headers.get('Authorization') ?? '';
  if (!token) return fallo('Sesión no válida. Vuelve a iniciar sesión.');

  // 1) Quién llama: debe ser administrador general (se comprueba en el servidor, no en la pantalla).
  const quien = createClient(url, anon, { global: { headers: { Authorization: token } }, auth: { persistSession: false } });
  const { data: u, error: eu } = await quien.auth.getUser();
  if (eu || !u?.user) return fallo('Sesión no válida. Vuelve a iniciar sesión.');
  const { data: perfil, error: ep } = await quien.rpc('api_mi_perfil');
  if (ep || !perfil || perfil.es_admin_general !== true || perfil.activo === false) return fallo('Solo el administrador general puede hacer esto.');
  const admin = u.user.id;

  let cuerpo: Record<string, unknown>;
  try { cuerpo = await req.json(); } catch { return fallo('Solicitud no válida.'); }

  const sb = createClient(url, servicio, { auth: { persistSession: false, autoRefreshToken: false } });

  if (cuerpo.accion === 'crear') {
    const correo = String(cuerpo.correo ?? '').trim().toLowerCase();
    const nombre = String(cuerpo.nombre ?? '').trim();
    const clave = String(cuerpo.clave ?? '');
    const roles = Array.isArray(cuerpo.roles) ? cuerpo.roles : [];
    if (!CORREO.test(correo)) return fallo('El correo no es válido.');
    if (!nombre || nombre.length > 60) return fallo('El nombre es obligatorio (máximo 60 caracteres).');
    if (clave.length < CLAVE_MINIMA) return fallo(`La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`);

    const { data: nuevo, error: ec } = await sb.auth.admin.createUser({ email: correo, password: clave, email_confirm: true });
    if (ec || !nuevo?.user) {
      return fallo(/already|registered|exists/i.test(ec?.message ?? '') ? 'Ya existe un usuario con ese correo.' : 'No se pudo crear el usuario.');
    }
    const { error: er } = await sb.rpc('adm_registrar_usuario', { p_user: nuevo.user.id, p_nombre: nombre, p_roles: roles, p_admin: admin });
    if (er) {
      await sb.auth.admin.deleteUser(nuevo.user.id); // deshace: no queda un usuario a medias
      return fallo(er.message.includes('|') ? er.message.split('|')[1] : 'No se pudo registrar el usuario.');
    }
    return responder({ ok: true, user_id: nuevo.user.id });
  }

  if (cuerpo.accion === 'clave') {
    const objetivo = String(cuerpo.user_id ?? '');
    const clave = String(cuerpo.clave ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(objetivo)) return fallo('Usuario no válido.');
    if (clave.length < CLAVE_MINIMA) return fallo(`La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`);
    const { error: eg } = await sb.auth.admin.updateUserById(objetivo, { password: clave });
    if (eg) return fallo('No se pudo cambiar la contraseña.');
    await sb.rpc('adm_auditar_clave', { p_user: objetivo, p_admin: admin }); // deja constancia, nunca guarda la clave
    return responder({ ok: true });
  }

  return fallo('Acción no reconocida.');
});
