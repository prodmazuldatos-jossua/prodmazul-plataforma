// Prodmazul · Fase 5 · Parte 3 · Exportador a Google (Edge Function «sync-exportar»).
// Despliegue:  supabase functions deploy sync-exportar --no-verify-jwt
// (la verificación del que llama se hace aquí dentro con el secreto SYNC_SECRETO; no usa la clave de administración de Supabase).
// Secretos que necesita (se guardan en el panel de Supabase, NUNCA en el código ni en Git):
//   APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, SYNC_SECRETO.  SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya los entrega Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ejecutar, mismoSecreto, probarGoogle, type Dependencias } from './nucleo.ts';

const CABECERAS = { 'Content-Type': 'application/json' };
const responder = (cuerpo: Record<string, unknown>, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: CABECERAS });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return responder({ ok: false, error: 'Método no permitido.' }, 405);

  // 1) Quién llama: solo la tarea programada de la base (o el administrador desde el SQL Editor) que conoce el secreto.
  const esperado = Deno.env.get('SYNC_SECRETO') ?? '';
  const recibido = req.headers.get('x-sync-secreto') ?? '';
  if (esperado.length < 20 || !mismoSecreto(esperado, recibido)) return responder({ ok: false, error: 'No autorizado.' }, 401);

  let cuerpo: Record<string, unknown> = {};
  try { cuerpo = await req.json(); } catch { cuerpo = {}; }

  const url = Deno.env.get('SUPABASE_URL');
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !servicio) return responder({ ok: false, error: 'Faltan las variables de Supabase en la función.' });
  const sb = createClient(url, servicio, { auth: { persistSession: false, autoRefreshToken: false } });

  const deps: Dependencias = {
    rpc: async (nombre, args) => {
      const { data, error } = await sb.rpc(nombre, args);
      return { data, error: error ? { message: error.message } : null };
    },
    fetch: (u, init) => fetch(u, init),
    ahora: () => Date.now(),
    env: (n) => Deno.env.get(n),
    log: (m) => console.log(m),
  };

  if (cuerpo.accion === 'ping') return responder(await probarGoogle(deps));

  try {
    const r = await ejecutar(deps, {
      origen: typeof cuerpo.origen === 'string' ? cuerpo.origen : 'manual',
      ejecucion_id: typeof cuerpo.ejecucion_id === 'number' ? cuerpo.ejecucion_id : null,
    });
    return responder({ ...r });
  } catch (e) {
    console.log(`sync-exportar: error inesperado: ${(e as Error)?.message ?? e}`);
    return responder({ ok: false, error: 'Error inesperado en el exportador. Revisa los registros de la función.' });
  }
});
