// Pruebas del exportador (Fase 5 · Parte 3): base de datos real simulada (PGlite, con las migraciones 1 a 14)
// + la lógica de la función sync-exportar + el receptor de Google (Codigo.gs) en su simulación.
// Ejecutar:  node --import ./registrar.mjs exportador.test.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { crearEntorno } from '../../apps-script/tests/mock_google.mjs';
import { ejecutar, limpiar, mismoSecreto, configuracionGoogle, probarGoogle } from '../../supabase/functions/sync-exportar/nucleo.ts';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dirMig = path.resolve(aqui, '../../supabase/migrations');
let ok = 0, mal = 0;
const t = (nombre, cond, extra = '') => { if (cond) { ok++; console.log('  ✔', nombre); } else { mal++; console.log('  ✘', nombre, extra); } };
const ADMIN = '00000000-0000-0000-0000-000000000001';
const OPER = '00000000-0000-0000-0000-000000000002';
const TOKEN = 'T'.repeat(40);
const URL_OK = 'https://script.google.com/macros/s/AKfycbzPRUEBA/exec';
const SECRETO = 'S'.repeat(40);

// ---------------------------------------------------------------- base de datos
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true),''), nullif(current_setting('request.jwt.sub', true),''))::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  grant usage on schema public to anon, authenticated;
  -- doble mínimo de pg_cron, pg_net y Vault (en Supabase son los reales)
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
  create function cron.schedule(p_name text, p_sched text, p_cmd text) returns bigint language plpgsql as $$
  declare v bigint; begin insert into cron.job(jobname, schedule, command) values (p_name, p_sched, p_cmd)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid into v; return v; end $$;
  create function cron.unschedule(p_name text) returns boolean language plpgsql as $$ begin delete from cron.job where jobname = p_name; return true; end $$;
  create schema net;
  create table net._peticiones (id bigserial primary key, url text, body jsonb, headers jsonb, timeout_ms int);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{"Content-Type": "application/json"}', timeout_milliseconds int default 5000) returns bigint language plpgsql as $$
  declare v bigint; begin insert into net._peticiones(url, body, headers, timeout_ms) values (url, body, headers, timeout_milliseconds) returning id into v; return v; end $$;
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, created_at timestamptz default now());
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, created_at from vault.secrets;
`);
for (const f of fs.readdirSync(dirMig).sort()) {
  try { await db.exec(fs.readFileSync(path.join(dirMig, f), 'utf8').replace(/^create extension.*$/gm, '')); }
  catch (e) { console.log('  ✘ no se aplica', f, e.message); process.exit(1); }
}
await db.exec(`
  insert into auth.users(id,email) values ('${ADMIN}','admin@x.com'),('${OPER}','op@x.com');
  update core.perfiles set es_admin_general = true, nombre = 'Admin' where user_id = '${ADMIN}';
  insert into core.usuario_modulo_rol values ('${OPER}','M01','operativo');
`);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const uno = async (sql, p = []) => Object.values((await q(sql, p))[0] ?? {})[0];
const comoUsuario = async (uid, sql) => {
  await db.exec('begin');
  try {
    await db.exec(`select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true); select set_config('request.jwt.claim.sub','${uid}', true); set local role authenticated;`);
    const r = await db.query(sql); await db.exec('commit'); return { data: r.rows[0] ? Object.values(r.rows[0])[0] : null, error: null };
  } catch (e) { await db.exec('rollback'); return { data: null, error: e.message }; }
};

const rpc = async (nombre, args) => {
  const k = Object.keys(args);
  try {
    const r = await db.query(`select public.${nombre}(${k.map((c, i) => `${c} => $${i + 1}`).join(', ')}) as r`, k.map((c) => args[c]));
    return { data: r.rows[0].r, error: null };
  } catch (e) { return { data: null, error: { message: e.message } }; }
};

// ---------------------------------------------------------------- Google simulado
function nuevoGoogle() {
  const R = crearEntorno({ ahora: new Date().toISOString() });
  const base = R.nuevoLibro('Prodmazul_Respaldo_' + new Date().getFullYear());
  base.insertSheet('_conexion');
  R.props.TOKEN = TOKEN; R.props.SHEET_ID = base.id; R.props.FOLDER_ID = '1carpeta';
  R.base = base; R.llamadas = 0; R.lotes = [];
  return R;
}
let G = nuevoGoogle();
let fallo = null; // función opcional que reemplaza la respuesta de Google
let entorno = { APPS_SCRIPT_URL: URL_OK, APPS_SCRIPT_TOKEN: TOKEN, SYNC_SECRETO: SECRETO };
const registros = [];
const deps = (extra = {}) => ({
  rpc,
  env: (n) => entorno[n],
  ahora: () => Date.now(),
  log: (m) => registros.push(m),
  fetch: async (url, init) => {
    if (fallo) return await fallo(url, init);
    const cuerpo = JSON.parse(init.body);
    G.llamadas++; if (cuerpo.accion === 'sincronizar') G.lotes.push(cuerpo.lote_id);
    return new Response(JSON.stringify(G.llamar(cuerpo)), { status: 200 });
  },
  ...extra,
});
const hoja = (n) => G.base.getSheetByName(n);
const filasHoja = (n) => (hoja(n) ? hoja(n).filas.slice(1).filter((f) => f.length) : []);
const est = async () => (await q('select * from core.sync_estado'))[0];
const cola = async (e) => Number(await uno(`select count(*) from core.sync_cola where estado = '${e}'`));
const limpiarCola = async () => { await db.exec(`delete from core.sync_cola`); };

// ---------------------------------------------------------------- 1) funciones puras
console.log('\nFunciones auxiliares');
t('mismoSecreto acepta el igual', mismoSecreto('abc12345', 'abc12345'));
t('mismoSecreto rechaza distinto, vacío o de otro largo', !mismoSecreto('abc12345', 'abc12346') && !mismoSecreto('', '') && !mismoSecreto('abc', 'abcd') && !mismoSecreto(null, 'x'));
t('limpiar oculta el token y la URL', !limpiar(`falló ${TOKEN} en ${URL_OK}`, [TOKEN, URL_OK]).includes('TTTT') && !limpiar(`x ${URL_OK}`, [URL_OK]).includes('AKfy'));
t('limpiar recorta textos largos', limpiar('x'.repeat(2000), []).length === 400);
t('configuración: falta la URL', configuracionGoogle((n) => ({ APPS_SCRIPT_TOKEN: TOKEN })[n]).error?.includes('APPS_SCRIPT_URL'));
t('configuración: falta el token', configuracionGoogle((n) => ({ APPS_SCRIPT_URL: URL_OK })[n]).error?.includes('APPS_SCRIPT_TOKEN'));
t('configuración: URL que no es del receptor', configuracionGoogle((n) => ({ APPS_SCRIPT_URL: 'https://ejemplo.com/exec', APPS_SCRIPT_TOKEN: TOKEN })[n]).error?.includes('no parece'));
t('configuración: URL que no termina en /exec', configuracionGoogle((n) => ({ APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AK/dev', APPS_SCRIPT_TOKEN: TOKEN })[n]).error?.includes('no parece'));
t('configuración correcta', configuracionGoogle((n) => entorno[n]).url === URL_OK);

// ---------------------------------------------------------------- 2) base de datos: programación
console.log('\nBase de datos · programación (migración 14)');
{
  t('las tablas y funciones nuevas existen', Number(await uno(`select count(*) from pg_proc where proname in ('sync_disparar','sync_programar','sync_pausar','sync_encolar_catalogos','api_sync_ahora','api_sync_ejecuciones','sync_ejecucion_abrir','sync_ejecucion_cerrar','sync_secreto')`)) === 9);
  t('sync_ejecuciones tiene la seguridad por filas activa', await uno(`select relrowsecurity from pg_class where oid = 'core.sync_ejecuciones'::regclass`) === true);
  let r = await comoUsuario(ADMIN, 'select count(*) from core.sync_ejecuciones');
  t('un usuario con sesión NO lee sync_ejecuciones', /permission denied/.test(r.error ?? ''), r.error);
  r = await comoUsuario(ADMIN, `select public.sync_ejecucion_abrir(null, 'manual')`);
  t('un usuario con sesión NO puede abrir ejecuciones (función interna)', /permission denied/.test(r.error ?? ''), r.error);
  r = await comoUsuario(ADMIN, `select core.sync_disparar('manual')`);
  t('un usuario con sesión NO llama a sync_disparar directamente', /permission denied/.test(r.error ?? ''), r.error);
  r = await comoUsuario(ADMIN, `select core.sync_programar()`);
  t('un usuario con sesión NO puede programar', /permission denied/.test(r.error ?? ''), r.error);

  let e = null; try { await db.query(`select core.sync_programar()`); } catch (x) { e = x.message; }
  t('programar sin secretos en Vault se rechaza con un mensaje claro', /E_CONFIG\|Antes de programar/.test(e ?? ''), e);
  e = null; try { await db.query(`select core.sync_disparar('manual')`); } catch (x) { e = x.message; }
  t('sincronizar ahora sin secretos se rechaza (manual)', /E_CONFIG\|Falta el secreto «sync_funcion_url»/.test(e ?? ''), e);
  const rc = (await q(`select core.sync_disparar('cron') as r`))[0].r;
  t('la tarea programada sin secretos NO falla: queda anotado', rc.ok === false && Number(await uno(`select count(*) from core.sync_ejecuciones where estado = 'con_error' and origen = 'cron'`)) === 1 && (await est()).ultimo_error.includes('sync_funcion_url'));

  await db.exec(`insert into vault.secrets (name, secret) values ('sync_funcion_url', 'https://ejemplo.com/otra'), ('sync_secreto', '${SECRETO}')`);
  e = null; try { await db.query(`select core.sync_disparar('manual')`); } catch (x) { e = x.message; }
  t('una dirección de función incorrecta se rechaza', /debe terminar en \/functions\/v1\/sync-exportar/.test(e ?? ''), e);
  await db.exec(`update vault.secrets set secret = 'https://abcd.supabase.co/functions/v1/sync-exportar' where name = 'sync_funcion_url'`);

  const d1 = (await q(`select core.sync_disparar('manual') as r`))[0].r;
  const pet = (await q('select * from net._peticiones order by id desc limit 1'))[0];
  t('sincronizar ahora crea la ejecución «pedida» y la llamada HTTP', d1.ejecucion_id > 0 && d1.request_id > 0 && pet.url === 'https://abcd.supabase.co/functions/v1/sync-exportar');
  t('la llamada lleva el secreto en la cabecera y el número de ejecución', pet.headers['x-sync-secreto'] === SECRETO && pet.body.ejecucion_id === d1.ejecucion_id && pet.body.origen === 'manual');
  t('la espera de la llamada es de 140 s', pet.timeout_ms === 140000);
  t('la ejecución queda «pedida» con su request_id', (await q(`select estado, request_id from core.sync_ejecuciones where ejecucion_id = ${d1.ejecucion_id}`))[0].estado === 'pedida');

  const p = (await q(`select core.sync_programar() as r`))[0].r;
  t('programar crea las dos tareas y activa la sincronización', p.programada === true && Number(await uno('select count(*) from cron.job')) === 2 && (await uno(`select valor from core.config where clave = 'sync_activa'`)) === true);
  const jobs = await q('select jobname, schedule, command from cron.job order by jobname');
  t('la tarea del exportador es cada 2 horas', jobs.find((j) => j.jobname === 'prodmazul-sync-exportar').schedule === '0 */2 * * *');
  t('la tarea de catálogos es el 1 de enero a las 05:10 UTC (00:10 Ecuador)', jobs.find((j) => j.jobname === 'prodmazul-sync-catalogos-anio').schedule === '10 5 1 1 *');
  t('los comandos programados no contienen secretos', jobs.every((j) => !j.command.includes(SECRETO) && !j.command.includes('http')));
  await db.query(`select core.sync_programar()`);
  t('programar dos veces no duplica las tareas', Number(await uno('select count(*) from cron.job')) === 2);

  r = await comoUsuario(ADMIN, 'select public.api_sync_ejecuciones(5)');
  t('el administrador ve las ejecuciones y que está programada', r.error === null && r.data.programada === true && r.data.ejecuciones.length >= 2, r.error);
  r = await comoUsuario(OPER, 'select public.api_sync_ejecuciones(5)');
  t('un operativo NO ve las ejecuciones', /E_PERMISO/.test(r.error ?? ''), r.error);
  r = await comoUsuario(OPER, 'select public.api_sync_ahora()');
  t('un operativo NO puede sincronizar ahora', /E_PERMISO/.test(r.error ?? ''), r.error);
  r = await comoUsuario(ADMIN, 'select public.api_sync_ahora()');
  t('el administrador SÍ puede sincronizar ahora (y queda en la auditoría)', r.error === null && r.data.ejecucion_id > 0 && Number(await uno(`select count(*) from core.auditoria where accion = 'sync_ahora'`)) === 1, r.error);

  await db.exec(`update core.sync_ejecuciones set pedida_en = now() - interval '10 minutes' where estado = 'pedida'`);
  r = await comoUsuario(ADMIN, 'select public.api_sync_ejecuciones(20)');
  t('una ejecución pedida que nunca arrancó se muestra como «sin_respuesta»', r.data.ejecuciones.some((x) => x.estado === 'sin_respuesta'));

  const ab = await rpc('sync_ejecucion_abrir', { p_id: d1.ejecucion_id, p_origen: 'manual' });
  t('abrir una ejecución pedida la pasa a «en_curso»', Number(ab.data) === d1.ejecucion_id && (await uno(`select estado from core.sync_ejecuciones where ejecucion_id = ${d1.ejecucion_id}`)) === 'en_curso');
  const ab2 = await rpc('sync_ejecucion_abrir', { p_id: null, p_origen: 'raro' });
  t('abrir sin número crea una nueva (origen desconocido pasa a «manual»)', Number(ab2.data) > d1.ejecucion_id && (await uno(`select origen from core.sync_ejecuciones where ejecucion_id = ${Number(ab2.data)}`)) === 'manual');
  const ce = await rpc('sync_ejecucion_cerrar', { p_id: d1.ejecucion_id, p_estado: 'raro', p_lotes: 0, p_filas: 0, p_error: null });
  t('cerrar con un estado inválido se rechaza', /E_DATOS/.test(ce.error?.message ?? ''));
  const ce2 = await rpc('sync_ejecucion_cerrar', { p_id: 999999, p_estado: 'ok', p_lotes: 0, p_filas: 0, p_error: null });
  t('cerrar una ejecución inexistente se rechaza', /E_LOTE/.test(ce2.error?.message ?? ''));

  const pa = (await q(`select core.sync_pausar() as r`))[0].r;
  t('pausar quita las tareas y apaga la sincronización', pa.programada === false && Number(await uno('select count(*) from cron.job')) === 0 && (await uno(`select valor from core.config where clave = 'sync_activa'`)) === false);
  await db.query(`select core.sync_pausar()`);
  t('pausar dos veces no da error', true);
  await db.exec(`delete from core.sync_ejecuciones; delete from net._peticiones;`);
  await db.exec(`delete from core.sync_cola where tabla = 'core.config'`);
}

// ---------------------------------------------------------------- 3) catálogos de año nuevo
console.log('\nCatálogos para un año nuevo');
{
  await limpiarCola();
  await db.exec(`insert into core.proveedores (nombre, nombre_normalizado) values ('Cat Uno', 'cat uno'), ('Cat Dos', 'cat dos')`);
  await limpiarCola();
  const n = Number(await uno('select core.sync_encolar_catalogos()'));
  const tablas = (await q(`select distinct tabla from core.sync_cola`)).map((x) => x.tabla);
  t('vuelve a anotar solo los catálogos del núcleo (no las recepciones)', n > 0 && tablas.every((x) => x.startsWith('core.')) && tablas.includes('core.proveedores') && tablas.includes('core.config'));
  const n2 = Number(await uno('select core.sync_encolar_catalogos()'));
  t('repetirlo no duplica filas pendientes', n2 === n && Number(await uno('select count(*) from core.sync_cola')) === n);
  await limpiarCola();
  await db.exec(`delete from core.proveedores`); await limpiarCola();
}

// ---------------------------------------------------------------- 4) exportador: flujo normal
console.log('\nExportador · flujo normal');
{
  await db.exec(`update core.sync_estado set ultimo_error = null, ultimo_error_en = null`);
  await db.query('select core.sync_encolar_todo()');
  // 450 proveedores + una recepción real (con gavetas) + catálogos
  await db.exec(`insert into core.proveedores (nombre, nombre_normalizado) select 'Proveedor ' || g, 'proveedor ' || g from generate_series(1, 450) g`);
  const rec = { estado: 'cerrado', fecha_llegada: new Date().toISOString().slice(0, 10), lote_id: '995-995-995', proveedor: 'PROVEEDOR 1', especie: 'LANGOSTINO', num_gavetas_bines: 3, libras_reportadas: 300, libras_planta: 295, guia_remision: 'G-1',
    gavetas: [{ num_gaveta: 1, peso_lb: 50 }, { num_gaveta: 2, peso_lb: 51 }, { num_gaveta: 3, peso_lb: 52 }], client_uuid: '11111111-1111-4111-8111-111111111111' };
  const gr = await comoUsuario(ADMIN, `select public.api_m01_guardar_recepcion('${JSON.stringify(rec)}'::jsonb)`);
  t('se guardó una recepción de prueba', gr.error === null, gr.error);
  const rid = gr.data?.recepcion_id;
  const total = Number(await uno(`select count(*) from core.sync_cola where estado = 'pendiente'`));
  t('hay más de 450 filas en la cola', total > 450, String(total));

  const r1 = await ejecutar(deps(), { origen: 'manual', max_lotes: 1 });
  t('con un máximo de 1 lote: envía 1 lote y avisa cuántas quedan', r1.ok && r1.lotes === 1 && r1.quedan > 0 && r1.quedan === total - r1.filas, JSON.stringify(r1));
  t('la ejecución queda registrada como «ok» con sus cifras', (await q(`select estado, lotes, filas, quedan from core.sync_ejecuciones where ejecucion_id = ${r1.ejecucion_id}`))[0].estado === 'ok');

  const r2 = await ejecutar(deps(), { origen: 'cron' });
  t('la siguiente ejecución termina todo el trabajo en varios lotes', r2.ok && r2.lotes >= 2 && r2.quedan === 0, JSON.stringify(r2));
  t('la cola quedó sin pendientes ni errores', (await cola('pendiente')) === 0 && (await cola('error')) === 0 && (await cola('enviando')) === 0);
  const e = await est();
  t('el estado marca la última sincronización correcta', e.ultima_sync_ok_en !== null && Number(e.lotes_enviados) >= 3 && e.ultimo_error === null);
  const nProv = Number(await uno('select count(*) from core.proveedores'));
  t('todos los proveedores (más de 450) están en la hoja, sin duplicados', nProv >= 450 && filasHoja('proveedores').length === nProv && new Set(filasHoja('proveedores').map((f) => f[0])).size === nProv, `${nProv} vs ${filasHoja('proveedores').length}`);
  t('la recepción y sus 3 gavetas llegaron a sus pestañas', filasHoja('recepciones').length === 1 && filasHoja('recepcion_gavetas').length === 3 && filasHoja('recepciones')[0][0] === rid);
  t('cada pestaña termina en «sincronizado_en»', hoja('proveedores').filas[0].at(-1) === 'sincronizado_en' && hoja('recepciones').filas[0].at(-1) === 'sincronizado_en');
  t('el libro de este año recibió las tablas con datos', ['proveedores', 'especies', 'lotes', 'recepciones', 'recepcion_gavetas', 'config', 'perfiles', 'usuario_modulo_rol'].every((n) => hoja(n) && filasHoja(n).length > 0));
  t('cada lote enviado a Google es distinto', new Set(G.lotes).size === G.lotes.length && G.lotes.length === r1.lotes + r2.lotes);

  const r3 = await ejecutar(deps(), { origen: 'cron' });
  t('sin cambios: no hay nada que enviar y no se llama a Google', r3.ok && r3.lotes === 0 && G.llamadas === G.lotes.length);

  // Reenvío total: no duplica
  await db.query('select core.sync_encolar_todo()');
  const antes = filasHoja('proveedores').length;
  const r4 = await ejecutar(deps());
  t('volver a anotar todo y reenviar NO duplica filas', r4.ok && filasHoja('proveedores').length === antes && filasHoja('recepcion_gavetas').length === 3 && r4.quedan === 0);

  // Cambio y borrado
  await db.exec(`update core.proveedores set nombre = 'Proveedor 7 CAMBIADO' where nombre = 'Proveedor 7'`);
  await db.exec(`delete from core.proveedores where nombre = 'Proveedor 8'`);
  const r5 = await ejecutar(deps());
  t('un cambio llega a la hoja y un borrado quita la fila', r5.ok && filasHoja('proveedores').length === nProv - 1 && filasHoja('proveedores').some((f) => f.includes('Proveedor 7 CAMBIADO')) && !filasHoja('proveedores').some((f) => f.includes('Proveedor 8')));

  // Quitar una gaveta: sale como borrar
  await comoUsuario(ADMIN, `select public.api_m01_guardar_recepcion('${JSON.stringify({ ...rec, recepcion_id: rid, version: gr.data.version, gavetas: rec.gavetas.slice(0, 2) })}'::jsonb)`);
  const r6 = await ejecutar(deps());
  t('quitar una gaveta la borra también de Google', r6.ok && filasHoja('recepcion_gavetas').length === 2, JSON.stringify(r6));
}

// ---------------------------------------------------------------- 5) fallos de Google
console.log('\nExportador · cuando Google falla (el sistema principal sigue)');
{
  await db.exec(`insert into core.proveedores (nombre, nombre_normalizado) values ('Falla A', 'falla a'), ('Falla B', 'falla b')`);
  const guardar = async (n) => { try { await db.exec(`insert into core.proveedores (nombre, nombre_normalizado) values ('Sigue ${n}', 'sigue ${n}')`); return true; } catch { return false; } };
  const pendientes0 = await cola('pendiente');

  // a) token mal puesto
  entorno = { ...entorno, APPS_SCRIPT_TOKEN: 'M'.repeat(40) };
  let r = await ejecutar(deps());
  t('token equivocado: la ejecución falla con mensaje claro', r.ok === false && /Google: no autorizado/.test(r.error), r.error);
  t('el mensaje de error NO contiene el token', !JSON.stringify(r).includes('M'.repeat(40)) && !registros.join(' ').includes('M'.repeat(40)));
  t('las filas quedan en «error» con 1 intento y espera', (await cola('error')) === pendientes0 && Number(await uno(`select max(intentos) from core.sync_cola where estado = 'error'`)) === 1 && (await uno(`select count(*) from core.sync_cola where estado = 'error' and proximo_intento_en > now()`)) > 0);
  t('el error queda en el estado y la ejecución como «con_error»', (await est()).ultimo_error.includes('no autorizado') && (await uno(`select estado from core.sync_ejecuciones where ejecucion_id = ${r.ejecucion_id}`)) === 'con_error');
  t('guardar datos en la aplicación SIGUE funcionando', await guardar(1));
  const rEsp = await ejecutar(deps());
  t('mientras espera, la siguiente ejecución solo toma lo nuevo (no martilla a Google)', rEsp.ok === false && Number(await uno(`select count(*) from core.sync_cola where estado = 'error' and intentos = 1`)) >= pendientes0);

  // b) recuperación: se corrige el token y pasa la espera
  entorno = { ...entorno, APPS_SCRIPT_TOKEN: TOKEN };
  await db.exec(`update core.sync_cola set proximo_intento_en = now() - interval '1 minute' where estado = 'error'`);
  r = await ejecutar(deps());
  t('con el token corregido todo se envía y la cola queda limpia', r.ok && r.quedan === 0 && (await cola('error')) === 0 && (await cola('pendiente')) === 0, JSON.stringify(r));
  t('«Sigue 1» y «Falla A» ya están en la hoja', filasHoja('proveedores').some((f) => f.includes('Sigue 1')) && filasHoja('proveedores').some((f) => f.includes('Falla A')));

  // c) HTML en lugar de JSON
  await guardar(2);
  fallo = async () => new Response('<html>Se necesita autorización</html>', { status: 200 });
  r = await ejecutar(deps());
  t('si Google devuelve una página en vez de JSON: error entendible', !r.ok && /no es JSON/.test(r.error) && (await cola('error')) > 0, r.error);

  // d) sin conexión
  await db.exec(`update core.sync_cola set proximo_intento_en = now() - interval '1 minute' where estado = 'error'`);
  fallo = async () => { throw new TypeError('fetch failed'); };
  r = await ejecutar(deps());
  t('sin conexión: error entendible, sin romper', !r.ok && /No se pudo conectar con Google/.test(r.error), r.error);

  // e) Google no responde (tiempo)
  await db.exec(`update core.sync_cola set proximo_intento_en = now() - interval '1 minute' where estado = 'error'`);
  fallo = (url, init) => new Promise((_, rechazar) => init.signal.addEventListener('abort', () => rechazar(init.signal.reason)));
  const t0 = Date.now();
  r = await ejecutar(deps(), { tope_google_ms: 60 });
  t('si Google no responde, se corta a tiempo y se anota', !r.ok && /no respondió/.test(r.error) && Date.now() - t0 < 3000, r.error);

  // f) respuesta parcial
  await db.exec(`update core.sync_cola set proximo_intento_en = now() - interval '1 minute' where estado = 'error'`);
  fallo = async () => new Response(JSON.stringify({ ok: false, parcial: true, procesadas: 10, faltan: 5, error: 'Tiempo agotado' }));
  r = await ejecutar(deps());
  t('respuesta «parcial»: se anota cuántas faltan y se reintenta', !r.ok && /faltan 5 filas/.test(r.error), r.error);

  // g) la base falla al confirmar
  await db.exec(`update core.sync_cola set proximo_intento_en = now() - interval '1 minute' where estado = 'error'`);
  fallo = null;
  const rpcRoto = async (n, a) => (n === 'sync_marcar_enviado' ? { data: null, error: { message: 'E_LOTE|simulado' } } : rpc(n, a));
  r = await ejecutar(deps({ rpc: rpcRoto }));
  t('si Google recibió pero la base no pudo confirmar, se avisa', !r.ok && /Google recibió el lote/.test(r.error), r.error);
  await db.exec(`update core.sync_cola set estado = 'pendiente', lote_id = null, reservado_hasta = null, proximo_intento_en = null where estado in ('enviando', 'error')`);
  r = await ejecutar(deps());
  t('el reenvío posterior no duplica nada', r.ok && filasHoja('proveedores').filter((f) => f.includes('Sigue 2')).length === 1);

  // h) tope de intentos: queda «agotada» sin bloquear a los demás
  await db.exec(`insert into core.proveedores (nombre, nombre_normalizado) values ('Mala fila', 'mala fila')`);
  fallo = async (u, init) => { const c = JSON.parse(init.body); const mala = JSON.stringify(c.tablas).includes('Mala fila'); if (mala) return new Response(JSON.stringify({ ok: false, error: 'fila rechazada' })); return new Response(JSON.stringify(G.llamar(c))); };
  let agotada = false;
  for (let i = 0; i < 8 && !agotada; i++) {
    await db.exec(`update core.sync_cola set proximo_intento_en = now() - interval '1 minute' where estado = 'error'`);
    await ejecutar(deps());
    agotada = Number(await uno(`select count(*) from core.sync_cola where estado = 'error' and intentos >= 5`)) > 0;
  }
  t('una fila que siempre falla llega al tope de 5 intentos y queda «agotada»', agotada);
  await guardar(3);
  const rr = await ejecutar(deps());
  t('y NO bloquea al resto: lo nuevo se envía', filasHoja('proveedores').some((f) => f.includes('Sigue 3')), JSON.stringify(rr));
  fallo = null;
  await db.exec(`delete from core.proveedores where nombre = 'Mala fila'`);
  await db.query('select public.api_sync_reintentar_errores()').catch(() => {});
  await db.exec(`update core.sync_cola set intentos = 0, proximo_intento_en = null where estado = 'error'`);
  const rf = await ejecutar(deps());
  t('al corregir la causa y reintentar, la cola queda limpia', rf.ok && (await cola('error')) === 0, JSON.stringify(rf));
}

// ---------------------------------------------------------------- 6) configuración y concurrencia
console.log('\nExportador · configuración incompleta y ejecuciones simultáneas');
{
  await limpiarCola();
  await db.exec(`insert into core.proveedores (nombre, nombre_normalizado) values ('Config 1', 'config 1')`);
  const guardado = entorno;
  entorno = { SYNC_SECRETO: SECRETO };
  let r = await ejecutar(deps());
  t('sin URL ni token: error claro y NO reserva filas de la cola', !r.ok && /APPS_SCRIPT_URL/.test(r.error) && (await cola('enviando')) === 0 && (await cola('pendiente')) > 0, r.error);
  t('el error de configuración queda visible en el estado', (await est()).ultimo_error.includes('APPS_SCRIPT_URL'));
  entorno = { ...guardado, APPS_SCRIPT_URL: 'https://ejemplo.com/exec' };
  r = await ejecutar(deps());
  t('una URL que no es de Google se rechaza antes de enviar nada', !r.ok && /no parece/.test(r.error) && G.llamadas === G.lotes.length);
  entorno = guardado;

  await db.exec(`insert into core.proveedores (nombre, nombre_normalizado) select 'Simul ' || g, 'simul ' || g from generate_series(1, 400) g`);
  const llamadasAntes = G.lotes.length;
  const [a, b] = await Promise.all([ejecutar(deps()), ejecutar(deps())]);
  t('dos ejecuciones a la vez no se pisan: todo se envía una sola vez', a.ok && b.ok && (await cola('pendiente')) === 0 && (await cola('enviando')) === 0 && new Set(G.lotes).size === G.lotes.length, JSON.stringify([a, b]));
  t('sin duplicados en la hoja', filasHoja('proveedores').filter((f) => String(f[2]).startsWith('Simul ')).length === 400 || filasHoja('proveedores').filter((f) => f.some((c) => String(c).startsWith('Simul '))).length === 400);
  t('los lotes de las dos ejecuciones suman lo enviado', G.lotes.length - llamadasAntes === a.lotes + b.lotes);

  const p = await probarGoogle(deps());
  t('la prueba de conexión (ping) devuelve la versión del receptor', p.ok === true && p.version === '2.0', JSON.stringify(p));
  entorno = { ...guardado, APPS_SCRIPT_TOKEN: 'X'.repeat(40) };
  const p2 = await probarGoogle(deps());
  t('el ping con token malo informa «no autorizado»', p2.ok === false && /no autorizado/.test(p2.error));
  entorno = guardado;
}

// ---------------------------------------------------------------- 7) la función (index.ts)
console.log('\nFunción sync-exportar (entrada, secreto y respuestas)');
{
  let manejador = null;
  globalThis.Deno = { serve: (fn) => { manejador = fn; }, env: { get: (n) => ({ ...entorno, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(30) })[n] } };
  await import('../../supabase/functions/sync-exportar/index.ts');
  const pedir = async (metodo, cab, cuerpo) => { const r = await manejador(new Request('https://x.supabase.co/functions/v1/sync-exportar', { method: metodo, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined })); return { estado: r.status, json: await r.json() }; };
  let r = await pedir('GET', {});
  t('solo acepta POST', r.estado === 405);
  r = await pedir('POST', {}, { origen: 'cron' });
  t('sin el secreto: 401 «No autorizado»', r.estado === 401 && r.json.error === 'No autorizado.');
  r = await pedir('POST', { 'x-sync-secreto': 'S'.repeat(39) + 'Z' }, { origen: 'cron' });
  t('con un secreto equivocado: 401', r.estado === 401);
  r = await pedir('POST', { Authorization: 'Bearer ' + SECRETO }, {});
  t('el secreto en otra cabecera no sirve', r.estado === 401);
  const guardadoEnv = entorno; entorno = { ...entorno, SYNC_SECRETO: 'corto' };
  r = await pedir('POST', { 'x-sync-secreto': 'corto' }, {});
  t('un secreto configurado demasiado corto nunca autoriza', r.estado === 401);
  entorno = guardadoEnv;
  r = await pedir('POST', { 'x-sync-secreto': SECRETO }, { origen: 'cron' });
  t('con el secreto correcto responde 200 con un resultado (aquí el doble de Supabase no tiene base)', r.estado === 200 && typeof r.json.ok === 'boolean');
  t('la respuesta de error nunca incluye secretos', !JSON.stringify(r.json).includes(TOKEN) && !JSON.stringify(r.json).includes(SECRETO));
}

console.log(`\nResultado: ${ok} correctas, ${mal} con fallo`);
process.exit(mal ? 1 : 0);
