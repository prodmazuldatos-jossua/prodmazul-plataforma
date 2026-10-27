// Función de servidor para que el administrador general cree usuarios y cambie contraseñas (versión 2).
// Despliegue: supabase functions deploy admin-usuarios --no-verify-jwt
// (la verificación de quién llama se hace dentro, en nucleo.ts). Usa las variables que Supabase ya entrega:
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY. NO pegues claves en el código.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { procesar, type Dependencias, type Respuesta } from './nucleo.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (cuerpo: Respuesta) =>
  new Response(JSON.stringify(cuerpo), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ ok: false, error: 'Método no permitido.' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const autorizacion = req.headers.get('Authorization') ?? '';
  const sb = createClient(url, servicio, { auth: { persistSession: false, autoRefreshToken: false } });
  const comoUsuario = (token: string) =>
    createClient(url, anon, { global: { headers: { Authorization: token } }, auth: { persistSession: false } });

  const deps: Dependencias = {
    async sesion(token) {
      const { data, error } = await comoUsuario(token).auth.getUser();
      return error || !data?.user ? null : { id: data.user.id };
    },
    async perfil(token) {
      const { data, error } = await comoUsuario(token).rpc('api_mi_perfil');
      return error ? null : data;
    },
    async crearCuenta(correo, clave) {
      const { data, error } = await sb.auth.admin.createUser({ email: correo, password: clave, email_confirm: true });
      if (error || !data?.user) return { error: /already|registered|exists/i.test(error?.message ?? '') ? 'existe' : 'otro' };
      return { id: data.user.id };
    },
    async borrarCuenta(id) { await sb.auth.admin.deleteUser(id); },
    async cambiarClave(id, clave) {
      const { error } = await sb.auth.admin.updateUserById(id, { password: clave });
      return !error;
    },
    async existePerfil(id) {
      const { data } = await sb.auth.admin.getUserById(id);
      return Boolean(data?.user);
    },
    async rpc(nombre, args) {
      const { error } = await sb.rpc(nombre, args);
      return error ? { error: error.message } : {};
    },
    log: (linea) => console.log(`admin-usuarios: ${linea}`),
  };

  let cuerpo: unknown = null;
  try { cuerpo = await req.json(); } catch { /* cuerpo inválido: procesar lo rechaza */ }
  try {
    return responder(await procesar(autorizacion, cuerpo, deps));
  } catch {
    console.log('admin-usuarios: error inesperado');
    return responder({ ok: false, error: 'No se pudo completar la acción.' });
  }
});
