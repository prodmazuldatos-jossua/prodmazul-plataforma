// Prueba de index.ts completo (cómo se conecta la lógica a Supabase), con un doble de supabase-js.
// Ejecutar:  node --experimental-strip-types --import ./registrar.mjs conexion.test.mjs
let ok = 0, mal = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('  ✔', n); } else { mal++; console.log('  ✘', n, x); } };
let manejador = null; const logs = [];
const entorno = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'CLAVE_ANON', SUPABASE_SERVICE_ROLE_KEY: 'CLAVE_SERVICIO' };
globalThis.Deno = { env: { get: (k) => entorno[k] }, serve: (f) => { manejador = f; } };
const orig = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
await import('../../supabase/functions/admin-usuarios/index.ts');
const { registro } = await import('./supabase_doble.mjs');
console.log = orig;
const llamar = async (cuerpo, { token = 'Bearer jwt', metodo = 'POST', raw } = {}) => {
  const req = new Request('http://localhost/', { method: metodo, headers: { Authorization: token, 'content-type': 'application/json' }, body: metodo === 'POST' ? (raw ?? JSON.stringify(cuerpo)) : undefined });
  const r = await manejador(req); return { status: r.status, json: await r.json().catch(() => null), cors: r.headers.get('Access-Control-Allow-Origin') };
};
const reset = (e = {}) => { registro.rpc.length = 0; registro.admin.length = 0; registro.escenario = e; };
const CLAVE = 'Zk7mQ2vR9xLp';

console.log('\nConexión de index.ts');
t('registra el servicio', typeof manejador === 'function');
let r = await manejador(new Request('http://localhost/', { method: 'OPTIONS' }));
t('responde a OPTIONS (CORS)', r.status === 200);
reset(); r = await llamar({ accion: 'version' }, { metodo: 'GET' });
t('rechaza métodos distintos de POST', r.json?.ok === false);
reset(); r = await llamar({ accion: 'version' });
t('administrador: responde la versión', r.json?.ok === true && r.json.version === '2.0');
reset({ perfil: { es_admin_general: false, activo: true } }); r = await llamar({ accion: 'crear', correo: 'a@x.com', nombre: 'A', clave: CLAVE });
t('no administrador: rechazado y sin crear cuenta', r.json?.ok === false && registro.admin.length === 0);
reset({ sesionValida: false }); r = await llamar({ accion: 'version' });
t('sesión inválida: rechazado', r.json?.ok === false);
reset(); r = await llamar({ accion: 'version' }, { token: '' });
t('sin cabecera Authorization: rechazado', r.json?.ok === false);
reset(); r = await llamar(null, { raw: 'esto no es json' });
t('cuerpo que no es JSON: respuesta controlada', r.json?.ok === false && r.status === 200);

reset(); r = await llamar({ accion: 'crear', correo: 'Pedro@X.com', nombre: 'Pedro', clave: CLAVE, roles: [{ modulo_id: 'M01', rol_id: 'operativo' }] });
t('crear: usa la clave de servicio para Auth y la base', r.json?.ok === true && r.json.user_id === 'NUEVO-ID' && registro.admin[0][0] === 'createUser' && registro.admin[0][1] === 'pedro@x.com' && registro.rpc[0][0] === 'adm_registrar_usuario');
t('crear: registra con el id del administrador que llamó', registro.rpc[0][1].p_admin === 'ADMIN-ID' && registro.rpc[0][1].p_user === 'NUEVO-ID');
t('la respuesta no contiene la contraseña', !JSON.stringify(r.json).includes(CLAVE));
t('el registro de la función no contiene la contraseña ni el correo', !logs.join('|').includes(CLAVE) && !logs.join('|').toLowerCase().includes('pedro'));
reset({ existe: true }); r = await llamar({ accion: 'crear', correo: 'p@x.com', nombre: 'P', clave: CLAVE });
t('correo repetido: mensaje claro', r.json?.ok === false && /Ya existe/.test(r.json.error));
reset({ errorRpc: 'E_VALIDACION|Los roles no son válidos.' }); r = await llamar({ accion: 'crear', correo: 'p@x.com', nombre: 'P', clave: CLAVE });
t('si falla el registro, deshace la cuenta', r.json?.ok === false && registro.admin.some((a) => a[0] === 'deleteUser' && a[1] === 'NUEVO-ID'));
reset(); r = await llamar({ accion: 'clave', user_id: '33333333-3333-3333-3333-333333333333', clave: CLAVE });
t('clave: cambia en Auth y deja constancia', r.json?.ok === true && registro.admin[0][0] === 'updateUserById' && registro.rpc[0][0] === 'adm_auditar_clave' && registro.rpc[0][1].p_admin === 'ADMIN-ID');
t('la constancia no incluye la clave', !JSON.stringify(registro.rpc).includes(CLAVE));
reset({ sinUsuario: true }); r = await llamar({ accion: 'clave', user_id: '33333333-3333-3333-3333-333333333333', clave: CLAVE });
t('clave de un usuario que no existe: rechazado', r.json?.ok === false && registro.admin.length === 0);
const sinServicio = registro.creados.filter((c) => !c.servicio);
t('el perfil se pide con el token de quien llama (no con la clave de servicio)', sinServicio.length > 0 && sinServicio.every((c) => c.token));
console.log(`\n${mal === 0 ? '✔' : '✘'} ${ok} correctas, ${mal} con fallo`);
process.exit(mal ? 1 : 0);
