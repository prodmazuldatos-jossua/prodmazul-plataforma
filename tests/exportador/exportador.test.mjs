// Pruebas del exportador (Fase 5 · Partes 3, 4 y 5): base de datos real simulada (PGlite, con las migraciones 1 a 16)
// + la lógica de la función sync-exportar + el receptor de Google (Codigo.gs) en su simulación.
// Ejecutar:  node --import ./registrar.mjs exportador.test.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { crearEntorno } from '../../apps-script/tests/mock_google.mjs';
import { ejecutar, purgar, limpiar, mismoSecreto, configuracionGoogle, probarGoogle } from '../../supabase/functions/sync-exportar/nucleo.ts';

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
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
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
  R.props.TOKEN = TOKEN; R.props.SHEET_ID = base.id; R.raizFotos = R.nuevaCarpeta('Prodmazul_Respaldo_Fotos'); R.props.FOLDER_ID = R.raizFotos.id;
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
  t('la prueba de conexión (ping) devuelve la versión del receptor', p.ok === true && p.version === '2.2', JSON.stringify(p));
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

// ---------------------------------------------------------------- 8) respaldo de fotos en Drive (Parte 4)
console.log('\nRespaldo de fotos en Drive (Parte 4)');
{
  await limpiarCola();
  G = nuevoGoogle();
  const jpg = (n, sem = 7) => { const b = Buffer.alloc(n, sem); b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; b[3] = 0xE0; return b; };
  let descargas = [];
  G.red = (u) => { descargas.push(u); return { codigo: 200, bytes: jpg(1200) }; };
  const firmar = async (ruta) => ({ url: `https://abcd1234.supabase.co/storage/v1/object/sign/m01-recepcion-fotos/${ruta}?token=eyJhbGciOi.JIUzI1NiIs_x-y` });
  const dd = (extra = {}) => deps({ firmar, ...extra });
  const hoy = new Date().toISOString().slice(0, 10);
  const rec = { estado: 'cerrado', fecha_llegada: hoy, lote_id: '995-995-995', proveedor: 'PROVEEDOR 1', especie: 'LANGOSTINO', num_gavetas_bines: 1, libras_reportadas: 100, libras_planta: 99, guia_remision: 'G-F4',
    gavetas: [{ num_gaveta: 1, peso_lb: 99 }], client_uuid: '22222222-2222-4222-8222-222222222222' };
  const gr = await comoUsuario(ADMIN, `select public.api_m01_guardar_recepcion('${JSON.stringify(rec)}'::jsonb)`);
  const rid = gr.data?.recepcion_id;
  t('hay una recepción de prueba para las fotos', gr.error === null && !!rid, gr.error);
  let contadorRuta = 0;
  const nuevaFoto = async (nn, { confirmada = true, purgada = false, bytes = 1200, rid2 = rid } = {}) => {
    const fid = `FOT-M01-995-995-995-${rid2}-${String(nn).padStart(2, '0')}`; const ruta = `M01/995-995-995/${rid2}/${fid}-abc${nn}${++contadorRuta}.jpg`;
    await db.query(`insert into m01_recepcion.fotos_meta (foto_id, recepcion_id, lote_id, nn, ruta, nombre, tipo_mime, tamano_bytes, confirmada, purgada_supabase_en)
                    values ($1,$2,'995-995-995',$3,$4,'f.jpg','image/jpeg',$5,$6,$7)`, [fid, rid2, nn, ruta, bytes, confirmada, purgada ? new Date().toISOString() : null]);
    await db.query(`delete from storage.objects where name = $1`, [ruta]);
    await db.query(`insert into storage.objects (bucket_id, name, metadata) values ('m01-recepcion-fotos', $1, $2)`, [ruta, JSON.stringify({ size: bytes })]);
    return { fid, ruta };
  };
  const f1 = await nuevaFoto(1), f2 = await nuevaFoto(2), f3 = await nuevaFoto(3), fSin = await nuevaFoto(4, { confirmada: false }), fPur = await nuevaFoto(5, { purgada: true });
  const driveDe = async (fid) => (await q(`select drive_file_id, respaldo_drive_en from m01_recepcion.fotos_meta where foto_id = $1`, [fid]))[0];
  const carp = () => ['M01_Recepcion', hoy.slice(0, 4), hoy.slice(5, 7), rid].reduce((c, n) => (c ? c.sub.find((x) => x.nombre === n) : null), G.raizFotos);

  // -- detectar pendientes
  let pend = await rpc('sync_fotos_pendientes', { p_max: 10 });
  t('detecta SOLO las fotos confirmadas, sin respaldo y no purgadas', pend.data.fotos.length === 3 && pend.data.pendientes_total === 3 && !pend.data.fotos.some((x) => [fSin.fid, fPur.fid].includes(x.foto_id)), JSON.stringify(pend));
  t('entrega el tamaño real guardado en Storage', pend.data.fotos.every((x) => Number(x.bytes_esperados) === 1200));
  const rep = await rpc('sync_fotos_pendientes', { p_max: 10 });
  t('mientras están reservadas no se entregan otra vez (nadie las duplica)', rep.data.vacio === true && rep.data.pendientes_total === 3);
  await db.exec(`update core.sync_fotos set reservado_hasta = now() - interval '1 minute'`);
  const rep2 = await rpc('sync_fotos_pendientes', { p_max: 2 });
  t('si la reserva vence, se vuelven a entregar (con el intento contado)', rep2.data.fotos.length === 2 && rep2.data.fotos.every((x) => x.intento === 2));
  await db.exec(`delete from core.sync_fotos`);
  t('las funciones de fotos no se pueden llamar con la sesión de un usuario', (await comoUsuario(ADMIN, `select public.sync_fotos_pendientes(5)`)).error !== null && (await comoUsuario(ADMIN, `select public.sync_foto_marcar_ok('x','1234567890abc')`)).error !== null);

  // -- sin firmar no hace nada
  let r = await ejecutar(deps());
  t('si la función no sabe firmar direcciones, no marca nada', r.ok && r.fotos === 0 && (await driveDe(f1.fid)).drive_file_id === null);

  // -- flujo normal
  r = await ejecutar(dd());
  t('respalda las 3 fotos y lo informa', r.ok && r.fotos === 3 && r.fotos_error === 0 && r.quedan_fotos === 0, JSON.stringify(r));
  const dr = await Promise.all([f1, f2, f3].map((f) => driveDe(f.fid)));
  t('guarda drive_file_id y la fecha SOLO tras la confirmación de Drive', dr.every((x) => /^1\d+AbCdEf$/.test(x.drive_file_id) && x.respaldo_drive_en));
  t('las no confirmadas y las purgadas no se tocan', (await driveDe(fSin.fid)).drive_file_id === null && (await driveDe(fPur.fid)).drive_file_id === null);
  const c = carp();
  t('en Drive quedan en M01_Recepcion/AAAA/MM/REC-…/foto_01..03.jpg', !!c && c.arch.map((a) => a.nombre).sort().join() === 'foto_01.jpg,foto_02.jpg,foto_03.jpg', c?.arch.map((a) => a.nombre).join());
  t('el archivo de Drive es idéntico al de Supabase', c.arch.every((a) => Buffer.compare(a.bytes, jpg(1200)) === 0));
  t('el estado cuenta las fotos respaldadas y la cola de fotos queda vacía', Number((await est()).fotos_respaldadas) === 3 && (await q('select * from core.sync_fotos')).length === 0);
  t('la ejecución registra fotos y fotos pendientes', (await q(`select fotos, fotos_error, quedan_fotos from core.sync_ejecuciones where ejecucion_id = ${r.ejecucion_id}`))[0].fotos === 3);
  t('queda en la bitácora de auditoría', Number(await uno(`select count(*) from core.auditoria where accion = 'respaldar_foto'`)) === 3);
  t('el drive_file_id llegó a la cola para el espejo en Sheets', Number(await uno(`select count(*) from core.sync_cola where tabla = 'm01_recepcion.fotos_meta'`)) > 0);

  // -- sin duplicados
  descargas = [];
  r = await ejecutar(dd());
  t('ejecutar de nuevo no vuelve a descargar ni a guardar nada', r.ok && r.fotos === 0 && descargas.length === 0 && carp().arch.length === 3);
  await rpc('sync_foto_marcar_ok', { p_foto_id: f1.fid, p_drive_file_id: 'OTRO_ID_DIFERENTE_1234' });
  t('confirmar dos veces la misma foto no cambia su identificador', (await driveDe(f1.fid)).drive_file_id === dr[0].drive_file_id);
  const idViejo = dr[0].drive_file_id;
  await db.query(`select core.sync_fotos_olvidar($1)`, [f1.fid]);
  r = await ejecutar(dd());
  t('si se pide repetir el respaldo, Drive REUTILIZA el archivo (no crea otro)', r.fotos === 1 && carp().arch.length === 3 && (await driveDe(f1.fid)).drive_file_id === idViejo && descargas.length === 0, JSON.stringify(r));

  // -- fallos
  await db.exec(`delete from m01_recepcion.fotos_meta where foto_id = '${f3.fid}'`);   // se borró en la app
  t('borrar la foto en la app NO borra el respaldo en Drive', carp().arch.length === 3);
  const f3b = await nuevaFoto(3);
  G.red = () => ({ codigo: 404, bytes: [] });
  r = await ejecutar(dd());
  const e1 = (await q('select * from core.sync_fotos'))[0];
  t('si la descarga falla: NO se marca respaldada y se anota el error', r.ok && r.fotos === 0 && r.fotos_error === 1 && (await driveDe(f3b.fid)).drive_file_id === null && e1.intentos === 1 && /404/.test(e1.ultimo_error), JSON.stringify(r));
  t('el error no contiene la dirección firmada ni el token', !/token=|eyJhbGci/.test(e1.ultimo_error) && !JSON.stringify(r).includes('eyJhbGci'));
  t('el estado muestra el último error de fotos', /404/.test((await est()).ultimo_error_foto));
  r = await ejecutar(dd());
  t('no reintenta de inmediato (espera entre intentos)', r.fotos === 0 && r.fotos_error === 0);
  await db.exec(`update core.sync_fotos set proximo_intento_en = null`);
  G.red = () => ({ codigo: 200, bytes: jpg(1200) });
  r = await ejecutar(dd());
  t('cuando el problema se corrige, el reintento la respalda', r.fotos === 1 && (await driveDe(f3b.fid)).drive_file_id !== null && (await q('select * from core.sync_fotos')).length === 0);

  // foto cuyo tamaño en Storage no coincide con el descargado
  await db.exec(`delete from m01_recepcion.fotos_meta where foto_id = '${fSin.fid}'`);
  const f4b = await nuevaFoto(4, { bytes: 999 });
  r = await ejecutar(dd());
  t('si el tamaño descargado no coincide con el de Storage, no se respalda', r.fotos === 0 && r.fotos_error === 1 && (await driveDe(f4b.fid)).drive_file_id === null && /Tamano distinto/.test((await q('select ultimo_error from core.sync_fotos'))[0].ultimo_error));
  await db.exec(`delete from m01_recepcion.fotos_meta where foto_id = '${f4b.fid}'`);

  // firma que falla
  await db.exec(`delete from m01_recepcion.fotos_meta where recepcion_id = '${rid}' and nn = 5`);
  const f5c = await nuevaFoto(5);
  r = await ejecutar(deps({ firmar: async () => ({ error: 'Object not found' }) }));
  t('si no se puede crear la dirección temporal: error de esa foto y no se llama a Google', r.fotos_error === 1 && (await driveDe(f5c.fid)).drive_file_id === null && /dirección temporal/.test((await q('select ultimo_error from core.sync_fotos'))[0].ultimo_error));
  await db.exec(`delete from core.sync_fotos`);

  // Google devuelve «ok» sin resultado de la foto
  const antes = G.lotes.length;
  fallo = async (u, init) => { const c = JSON.parse(init.body); return new Response(JSON.stringify(c.accion === 'guardar_fotos' ? { ok: true, resultados: [] } : G.llamar(c)), { status: 200 }); };
  r = await ejecutar(dd());
  t('si el receptor no devuelve resultado para una foto, NO se marca respaldada', r.fotos === 0 && r.fotos_error === 1 && (await driveDe(f5c.fid)).drive_file_id === null);
  // Google caído durante las fotos
  await db.exec(`delete from core.sync_fotos`);
  fallo = async (u, init) => { const c = JSON.parse(init.body); if (c.accion === 'guardar_fotos') return new Response('<html>Error</html>', { status: 500 }); return new Response(JSON.stringify(G.llamar(c)), { status: 200 }); };
  r = await ejecutar(dd());
  t('si Google falla en las fotos: error por foto, nada marcado, y los datos ya enviados no se pierden', r.fotos === 0 && r.fotos_error >= 1 && (await driveDe(f5c.fid)).drive_file_id === null);
  fallo = null;
  await db.exec(`delete from core.sync_fotos`);

  // carpeta pública
  G.raizFotos.acceso = 'ANYONE_WITH_LINK';
  r = await ejecutar(dd());
  const ep = (await q('select ultimo_error from core.sync_fotos'))[0];
  t('si la carpeta de Drive tiene enlace compartido, NO se respalda nada', r.fotos === 0 && r.fotos_error >= 1 && /enlace compartido/.test(ep.ultimo_error) && (await driveDe(f5c.fid)).drive_file_id === null);
  G.raizFotos.acceso = 'PRIVATE';
  await db.exec(`update core.sync_fotos set proximo_intento_en = null`);

  // agotadas
  await db.exec(`update core.sync_fotos set intentos = 5, proximo_intento_en = null`);
  const ag = await rpc('sync_fotos_pendientes', { p_max: 5 });
  t('con 5 intentos fallidos la foto queda «agotada» y deja de intentarse', ag.data.vacio === true);
  const es = await comoUsuario(ADMIN, `select public.api_sync_estado()`);
  t('el administrador ve fotos agotadas, con error y respaldadas', es.data.fotos_agotadas === 1 && es.data.fotos_respaldadas === 3 && es.data.fotos_sin_respaldo === 1, JSON.stringify(es.data));
  t('un usuario operativo no ve el estado', (await comoUsuario(OPER, `select public.api_sync_estado()`)).error !== null);
  const rr = await comoUsuario(ADMIN, `select public.api_sync_reintentar_errores()`);
  t('«reintentar errores» también reactiva las fotos agotadas', rr.data.fotos === 1 && (await q('select intentos from core.sync_fotos')).every((x) => x.intentos === 0), JSON.stringify(rr));
  r = await ejecutar(dd());
  t('y entonces se respalda', r.fotos === 1 && (await driveDe(f5c.fid)).drive_file_id !== null);

  // muchas fotos: varias tandas
  const rec2 = { ...rec, client_uuid: '33333333-3333-4333-8333-333333333333', guia_remision: 'G-F4B' };
  const g2 = await comoUsuario(ADMIN, `select public.api_m01_guardar_recepcion('${JSON.stringify(rec2)}'::jsonb)`);
  const rid2 = g2.data.recepcion_id;
  for (let i = 1; i <= 5; i++) await nuevaFoto(i, { rid2 });
  const rec3 = { ...rec, client_uuid: '44444444-4444-4444-8444-444444444444', guia_remision: 'G-F4C' };
  const g3 = await comoUsuario(ADMIN, `select public.api_m01_guardar_recepcion('${JSON.stringify(rec3)}'::jsonb)`);
  for (let i = 1; i <= 4; i++) await nuevaFoto(i, { rid2: g3.data.recepcion_id });
  r = await ejecutar(dd());
  t('9 fotos pendientes se respaldan en varias tandas de 5', r.fotos === 9 && r.quedan_fotos === 0 && r.detalle.filter((x) => /tanda/.test(x)).length === 2, JSON.stringify(r.detalle));
  t('cada recepción tiene su propia carpeta en Drive', [rid2, g3.data.recepcion_id].every((x) => G.raizFotos.sub[0].sub[0].sub[0].sub.some((c) => c.nombre === x)));
  t('el total en Drive coincide con el total en Supabase', G.llamar({ token: TOKEN, accion: 'contar_fotos', anio: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)) }).fotos === Number(await uno(`select count(*) from m01_recepcion.fotos_meta where drive_file_id is not null and to_char(subido_en,'YYYY-MM') = '${hoy.slice(0, 7)}'`)));

  // tiempo
  const f7 = await nuevaFoto(1, { rid2: (await comoUsuario(ADMIN, `select public.api_m01_guardar_recepcion('${JSON.stringify({ ...rec, client_uuid: '55555555-5555-4555-8555-555555555555', guia_remision: 'G-F4D' })}'::jsonb)`)).data.recepcion_id });
  r = await ejecutar(dd(), { tope_nueva_tanda_ms: -1 });
  t('si se acabó el tiempo, no empieza fotos y lo deja dicho', r.fotos === 0 && r.detalle.some((x) => /se detuvo por tiempo/.test(x)) && (await driveDe(f7.fid)).drive_file_id === null);
  r = await ejecutar(dd());
  t('la siguiente ejecución la retoma', r.fotos === 1);
  r = await ejecutar(dd());
  t('la cola de datos y la de fotos terminan vacías', (await cola('pendiente')) === 0 && Number(await uno(`select count(*) from core.sync_fotos`)) === 0);
}

// ---------------------------------------------------------------- 9) retención de fotos (Parte 5)
console.log('\nRetención de 60 días (Parte 5)');
{
  await limpiarCola();
  G = nuevoGoogle();
  const jpg = (n, sem = 7) => { const b = Buffer.alloc(n, sem); b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; b[3] = 0xE0; return b; };
  G.red = () => ({ codigo: 200, bytes: jpg(1200) });
  const firmar = async (ruta) => ({ url: `https://abcd1234.supabase.co/storage/v1/object/sign/m01-recepcion-fotos/${ruta}?token=eyJhbGciOi.JIUzI1NiIs_x-y` });
  let borradas = []; let falloBorrar = null;
  const borrar = async (rutas) => {
    if (falloBorrar) return { error: falloBorrar };
    borradas.push(...rutas);
    for (const r of rutas) await db.query(`delete from storage.objects where name = $1`, [r]);
    return {};
  };
  const dd = (extra = {}) => deps({ firmar, borrar, ...extra });
  const hoy = new Date().toISOString().slice(0, 10);
  let n = 0;
  const nuevaRec = async () => {
    n++;
    const rec = { estado: 'cerrado', fecha_llegada: hoy, lote_id: '995-995-995', proveedor: 'PROVEEDOR 1', especie: 'LANGOSTINO', num_gavetas_bines: 1, libras_reportadas: 100, libras_planta: 99, guia_remision: 'G-F5-' + n,
      gavetas: [{ num_gaveta: 1, peso_lb: 99 }], client_uuid: `6666666${n % 10}-6666-4666-8666-66666666666${n % 10}`.replace(/(.{8})-(.{4})-(.{4})-(.{4})-(.*)/, '$1-$2-$3-$4-$5').slice(0, 36) };
    rec.client_uuid = `66666666-6666-4666-8666-${String(100000000000 + n)}`;
    const g = await comoUsuario(ADMIN, `select public.api_m01_guardar_recepcion('${JSON.stringify(rec)}'::jsonb)`);
    return g.data.recepcion_id;
  };
  let cr = 0;
  const foto = async (rid, nn, { dias = 70, respaldo = true, horasRespaldo = 48, bytes = 1200 } = {}) => {
    const fid = `FOT-M01-995-995-995-${rid}-${String(nn).padStart(2, '0')}`; const ruta = `M01/995-995-995/${rid}/${fid}-ab${++cr}.jpg`;
    await db.query(`insert into m01_recepcion.fotos_meta (foto_id, recepcion_id, lote_id, nn, ruta, nombre, tipo_mime, tamano_bytes, confirmada, subido_en)
                    values ($1,$2,'995-995-995',$3,$4,'f.jpg','image/jpeg',$5,true, now() - make_interval(days => $6))`, [fid, rid, nn, ruta, bytes, dias]);
    await db.query(`insert into storage.objects (bucket_id, name, metadata) values ('m01-recepcion-fotos', $1, $2)`, [ruta, JSON.stringify({ size: bytes })]);
    if (respaldo) {
      await ejecutar(dd(), { max_lotes: 0 });                       // respalda de verdad en el Drive simulado
      await db.query(`update m01_recepcion.fotos_meta set respaldo_drive_en = now() - make_interval(hours => $2) where foto_id = $1`, [fid, horasRespaldo]);
    }
    return { fid, ruta };
  };
  const fila = async (fid) => (await q(`select drive_file_id, respaldo_drive_en, purgada_supabase_en from m01_recepcion.fotos_meta where foto_id = $1`, [fid]))[0];
  const existeObj = async (ruta) => Number(await uno(`select count(*) from storage.objects where name = $1`, [ruta])) === 1;
  const activar = () => db.exec(`update core.config set valor = 'true'::jsonb where clave = 'purga_activa'`);
  const rid = await nuevaRec();
  t('hay una recepción de prueba', !!rid);

  // -- apagada por defecto
  const vieja = await foto(rid, 1);
  t('el parámetro de retención es 60 días y la purga viene APAGADA', (await uno(`select valor from core.config where clave = 'dias_retencion_fotos'`)) === 60 && (await uno(`select valor from core.config where clave = 'purga_activa'`)) === false);
  let r = await purgar(dd(), { origen: 'manual' });
  t('apagada: no borra nada aunque haya una foto vieja con copia', r.ok && r.purgadas === 0 && r.candidatas === 0 && borradas.length === 0 && (await existeObj(vieja.ruta)) && r.detalle.some((x) => /apagada/.test(x)), JSON.stringify(r));
  t('el administrador no puede pedir «purgar ahora» si está apagada', (await comoUsuario(ADMIN, `select public.api_purga_ahora()`)).error?.startsWith('E_CONFIG'));

  // -- reglas de edad y copia
  await activar();
  const rid2 = await nuevaRec(), rid3 = await nuevaRec(), rid4 = await nuevaRec(), rid5 = await nuevaRec();
  const joven = await foto(rid2, 1, { dias: 30 });
  const sinCopia = await foto(rid3, 1, { dias: 90, respaldo: false });
  const reciente = await foto(rid4, 1, { dias: 90, horasRespaldo: 2 });
  const noConf = rid5 && (await foto(rid5, 1, { dias: 90, respaldo: false }));
  await db.query(`update m01_recepcion.fotos_meta set confirmada = false where foto_id = $1`, [noConf.fid]);
  let c = (await rpc('purga_fotos_candidatas', { p_max: 100 })).data;
  t('solo es candidata la foto vieja con copia confirmada hace más de 24 h', c.fotos.length === 1 && c.fotos[0].foto_id === vieja.fid && c.candidatas_total === 1, JSON.stringify(c));
  t('una foto de 30 días NO es candidata (menos de 60)', !c.fotos.some((x) => x.foto_id === joven.fid));
  t('una foto vieja SIN copia en Drive NO es candidata', !c.fotos.some((x) => x.foto_id === sinCopia.fid));
  t('una foto con copia confirmada hace 2 horas NO es candidata (gracia de 24 h)', !c.fotos.some((x) => x.foto_id === reciente.fid));
  t('una foto sin confirmar NO es candidata', !c.fotos.some((x) => x.foto_id === noConf.fid));
  t('la candidata trae ruta, id de Drive y tamaño', c.fotos[0].ruta === vieja.ruta && c.fotos[0].drive_file_id.length > 10 && Number(c.fotos[0].bytes_esperados) === 1200);
  await db.exec(`update core.config set valor = '10'::jsonb where clave = 'dias_retencion_fotos'`);
  c = (await rpc('purga_fotos_candidatas', { p_max: 100 })).data;
  t('con la retención en 10 días, la de 30 días también es candidata (fechas simuladas)', c.fotos.some((x) => x.foto_id === joven.fid));
  await db.exec(`update core.config set valor = '60'::jsonb where clave = 'dias_retencion_fotos'`);

  // -- seguridad
  t('un usuario con sesión NO puede llamar a las funciones de purga', (await comoUsuario(ADMIN, `select public.purga_fotos_candidatas(5)`)).error !== null && (await comoUsuario(ADMIN, `select public.purga_foto_marcar_ok('x')`)).error !== null);
  t('un operativo no ve las purgas', (await comoUsuario(OPER, `select public.api_purgas()`)).error?.startsWith('E_PERMISO'));

  // -- purga normal
  const driveId = (await fila(vieja.fid)).drive_file_id;
  r = await purgar(dd(), { origen: 'manual' });
  t('purga la foto vieja con copia verificada', r.ok && r.candidatas === 1 && r.verificadas === 1 && r.purgadas === 1 && r.omitidas === 0 && r.errores === 0, JSON.stringify(r));
  t('el archivo se borró del almacenamiento y SOLO ese', borradas.length === 1 && borradas[0] === vieja.ruta && !(await existeObj(vieja.ruta)) && (await existeObj(joven.ruta)) && (await existeObj(sinCopia.ruta)) && (await existeObj(reciente.ruta)));
  const fv = await fila(vieja.fid);
  t('la fila de la foto se CONSERVA con su copia de Drive y la fecha de purga', fv.purgada_supabase_en && fv.drive_file_id === driveId && fv.respaldo_drive_en);
  t('las demás fotos no se tocaron', (await fila(joven.fid)).purgada_supabase_en === null && (await fila(sinCopia.fid)).purgada_supabase_en === null && (await fila(reciente.fid)).purgada_supabase_en === null);
  t('queda en la auditoría con la ruta y el id de Drive', Number(await uno(`select count(*) from core.auditoria where accion = 'purgar_foto' and detalle->>'foto_id' = '${vieja.fid}' and detalle->>'drive_file_id' = '${driveId}'`)) === 1);
  t('la corrida queda registrada', (await q(`select estado, purgadas, candidatas, quedan from core.purga_ejecuciones where purga_id = ${r.purga_id}`))[0].purgadas === 1);
  t('la copia en Drive sigue intacta', Object.values(G.filesDrive).some((a) => a.id === driveId && !a.papelera));
  r = await purgar(dd());
  t('repetir no vuelve a borrar ni a verificar', r.ok && r.candidatas === 0 && borradas.length === 1);
  t('la foto purgada ya no se intenta respaldar de nuevo', (await rpc('sync_fotos_pendientes', { p_max: 50 })).data.fotos.every((x) => x.foto_id !== vieja.fid));
  t('no se puede «olvidar» el respaldo de una foto ya purgada', (await db.query(`select core.sync_fotos_olvidar('${vieja.fid}')`).then(() => 'ok', (e) => e.message)).startsWith('E_ESTADO'));

  // -- la aplicación
  const lista = await comoUsuario(ADMIN, `select public.api_m01_fotos_recepcion('${rid}')`);
  t('la aplicación recibe «archivada» = true y la fecha', lista.data[0].archivada === true && !!lista.data[0].archivada_en);
  const lista2 = await comoUsuario(ADMIN, `select public.api_m01_fotos_recepcion('${rid2}')`);
  t('y «archivada» = false para una foto normal', lista2.data[0].archivada === false);
  t('no se puede quitar una foto archivada desde la aplicación', (await comoUsuario(ADMIN, `select public.api_m01_eliminar_foto('${vieja.fid}')`)).error?.startsWith('E_FOTOS'));
  t('sí se puede quitar una foto normal', (await comoUsuario(ADMIN, `select public.api_m01_eliminar_foto('${joven.fid}')`)).error === null);

  // -- Drive no confirma: NO se borra
  const ridA = await nuevaRec();
  const sinArchivo = await foto(ridA, 1);
  const driveA = (await fila(sinArchivo.fid)).drive_file_id;
  const archivoA = G.filesDrive[driveA];
  archivoA.papelera = true;
  r = await purgar(dd());
  t('si la copia está en la papelera de Drive: NO se borra, se anota el motivo', r.ok && r.verificadas === 0 && r.omitidas === 1 && r.purgadas === 0 && (await existeObj(sinArchivo.ruta)) && (await fila(sinArchivo.fid)).purgada_supabase_en === null, JSON.stringify(r));
  const pf = (await q(`select intentos, ultimo_error, proximo_intento_en from core.purga_fotos where foto_id = $1`, [sinArchivo.fid]))[0];
  t('queda el error y una espera de un día antes de reintentar', pf.intentos === 1 && /papelera/.test(pf.ultimo_error) && new Date(pf.proximo_intento_en) > new Date(Date.now() + 20 * 3600e3));
  r = await purgar(dd());
  t('al día siguiente (misma corrida) no se reintenta', r.candidatas === 0);
  archivoA.papelera = false;
  await db.exec(`update core.purga_fotos set proximo_intento_en = null, intentos = 1`);
  const tam = archivoA.bytes; archivoA.bytes = Buffer.alloc(5);
  r = await purgar(dd());
  t('si el archivo de Drive pesa distinto: NO se borra', r.omitidas === 1 && r.purgadas === 0 && (await existeObj(sinArchivo.ruta)));
  archivoA.bytes = tam; archivoA.desc = 'otra cosa';
  await db.exec(`update core.purga_fotos set proximo_intento_en = null, intentos = 1`);
  r = await purgar(dd());
  t('si el archivo de Drive no es el de esa foto (descripción distinta): NO se borra', r.omitidas === 1 && r.purgadas === 0 && (await existeObj(sinArchivo.ruta)));
  archivoA.desc = sinArchivo.ruta;
  await db.exec(`update core.purga_fotos set proximo_intento_en = null, intentos = 1`);
  delete G.filesDrive[driveA];
  r = await purgar(dd());
  t('si el archivo ya no existe en Drive: NO se borra', r.omitidas === 1 && r.purgadas === 0 && (await existeObj(sinArchivo.ruta)));
  G.filesDrive[driveA] = archivoA;
  await db.exec(`update core.purga_fotos set proximo_intento_en = null, intentos = 1`);

  // -- el almacenamiento falla
  falloBorrar = 'Storage no disponible';
  r = await purgar(dd());
  t('si el almacenamiento no borra: la foto NO se marca purgada y queda el error', r.errores === 1 && r.purgadas === 0 && (await fila(sinArchivo.fid)).purgada_supabase_en === null && /Storage no disponible/.test((await q(`select ultimo_error from core.purga_fotos`))[0].ultimo_error));
  falloBorrar = null;
  await db.exec(`update core.purga_fotos set proximo_intento_en = null, intentos = 1`);

  // -- Google caído: no se borra nada
  const fallaGoogle = async () => new Response('<html>Error</html>', { status: 500 });
  fallo = fallaGoogle;
  r = await purgar(dd());
  t('si Google no responde: la corrida termina con error y NO se borra nada', !r.ok && /no se borró nada/.test(r.error) && (await existeObj(sinArchivo.ruta)) && (await fila(sinArchivo.fid)).purgada_supabase_en === null, JSON.stringify(r));
  t('y la foto no se penaliza por la caída de Google', (await q(`select intentos from core.purga_fotos where foto_id = $1`, [sinArchivo.fid]))[0].intentos === 1);
  fallo = null;
  t('el error de Google no contiene el token', !JSON.stringify(r).includes(TOKEN));
  t('la corrida queda «con_error» en el registro', (await q(`select estado from core.purga_ejecuciones where purga_id = ${r.purga_id}`))[0].estado === 'con_error');

  // -- ahora sí
  await db.exec(`update core.purga_fotos set proximo_intento_en = null, intentos = 1`);
  r = await purgar(dd());
  t('con todo en orden, la foto pendiente se purga', r.purgadas === 1 && (await fila(sinArchivo.fid)).purgada_supabase_en !== null && !(await existeObj(sinArchivo.ruta)));
  t('y su historial de errores se limpia', Number(await uno(`select count(*) from core.purga_fotos where foto_id = '${sinArchivo.fid}'`)) === 0);

  // -- ruta sospechosa
  const ridB = await nuevaRec();
  const rara = await foto(ridB, 1);
  await db.query(`update m01_recepcion.fotos_meta set ruta = 'otro-bucket/../secreto.jpg' where foto_id = $1`, [rara.fid]);
  const antes = borradas.length;
  r = await purgar(dd());
  t('una ruta que no tiene la forma de una foto de Recepción NUNCA se borra', r.omitidas === 1 && borradas.length === antes && (await fila(rara.fid)).purgada_supabase_en === null);
  await db.query(`delete from m01_recepcion.fotos_meta where foto_id = $1`, [rara.fid]);

  // -- muchas fotos: varias tandas
  const rids = []; for (let i = 0; i < 6; i++) rids.push(await nuevaRec());
  for (const x of rids) for (let k = 1; k <= 5; k++) await db.query(`insert into m01_recepcion.fotos_meta (foto_id, recepcion_id, lote_id, nn, ruta, nombre, tipo_mime, tamano_bytes, confirmada, subido_en, drive_file_id, respaldo_drive_en)
     values ($1,$2,'995-995-995',$3,$4,'f.jpg','image/jpeg',1200,true, now() - interval '100 days', $5, now() - interval '5 days')`,
     [`FOT-M01-995-995-995-${x}-0${k}`, x, k, `M01/995-995-995/${x}/FOT-M01-995-995-995-${x}-0${k}-zz${k}.jpg`, 'DRIVEID' + x.slice(-4) + k + 'ABCDEFGH']);
  // el Drive simulado: crea los archivos que corresponden a esas 30 fotos
  const raizFotos = G.raizFotos;
  for (const x of rids) for (let k = 1; k <= 5; k++) {
    const f = raizFotos.createFile({ n: `foto_0${k}.jpg`, m: 'image/jpeg', b: jpg(1200) });
    f.setDescription(`M01/995-995-995/${x}/FOT-M01-995-995-995-${x}-0${k}-zz${k}.jpg`);
    await db.query(`update m01_recepcion.fotos_meta set drive_file_id = $2 where foto_id = $1`, [`FOT-M01-995-995-995-${x}-0${k}`, f.id]);
  }
  const tot = Number((await rpc('purga_fotos_candidatas', { p_max: 1 })).data.candidatas_total);
  r = await purgar(dd(), { tanda: 10, max_tandas: 2 });
  t('con tandas de 10 y máximo 2 tandas, purga 20 y deja constancia de lo que queda', r.purgadas === 20 && r.quedan === tot - 20, JSON.stringify([r.purgadas, r.quedan, tot]));
  r = await purgar(dd(), { tanda: 10, max_tandas: 5 });
  t('la siguiente corrida termina el resto', r.purgadas === tot - 20 && r.quedan === 0);
  t('se pidió borrar exactamente las 30 rutas de esas fotos, una sola vez cada una', borradas.filter((x) => /-zz\d\.jpg$/.test(x)).length === 30 && new Set(borradas).size === borradas.length);

  // -- tiempo
  const ridC = await nuevaRec();
  await db.query(`insert into m01_recepcion.fotos_meta (foto_id, recepcion_id, lote_id, nn, ruta, nombre, tipo_mime, tamano_bytes, confirmada, subido_en, drive_file_id, respaldo_drive_en)
     values ($1,$2,'995-995-995',1,$3,'f.jpg','image/jpeg',1200,true, now() - interval '100 days', 'DRIVEIDTIEMPO12345', now() - interval '5 days')`, [`FOT-M01-995-995-995-${ridC}-01`, ridC, `M01/995-995-995/${ridC}/FOT-M01-995-995-995-${ridC}-01-zz9.jpg`]);
  let reloj = Date.now();
  r = await purgar(deps({ borrar, firmar, ahora: () => (reloj += 200_000) }), { origen: 'prueba' });
  t('si la corrida se queda sin tiempo, se detiene limpiamente', r.purgadas <= 1 && (r.ok || /Drive/.test(r.error ?? '')), JSON.stringify(r));

  // -- la tarea diaria
  await db.exec(`insert into vault.secrets (name, secret) values ('sync_funcion_url', 'https://abcd.supabase.co/functions/v1/sync-exportar'), ('sync_secreto', '${'S'.repeat(40)}') on conflict (name) do nothing`);
  const pr = await db.query(`select core.purga_programar() as r`);
  t('programar crea la tarea diaria a las 08:30 UTC (03:30 de Ecuador) y activa la purga', (await uno(`select schedule from cron.job where jobname = 'prodmazul-purga-fotos'`)) === '30 8 * * *' && (await uno(`select valor from core.config where clave = 'purga_activa'`)) === true);
  t('el texto de la tarea no contiene secretos', !(await uno(`select command from cron.job where jobname = 'prodmazul-purga-fotos'`)).includes('SSSS'));
  const dis = (await comoUsuario(ADMIN, `select public.api_purga_ahora()`));
  t('«purgar ahora» pide la corrida con la acción «purgar» y el secreto en la cabecera', dis.error === null && (await q(`select body, headers from net._peticiones order by id desc limit 1`))[0].body.accion === 'purgar' && (await q(`select headers from net._peticiones order by id desc limit 1`))[0].headers['x-sync-secreto'] === 'S'.repeat(40));
  const lp = await comoUsuario(ADMIN, `select public.api_purgas(5)`);
  t('el administrador ve la lista de corridas, lo archivado y lo que falta', lp.data.programada === true && lp.data.activa === true && lp.data.fotos_archivadas >= 1 && Array.isArray(lp.data.ejecuciones) && lp.data.dias_retencion === 60);
  await db.exec(`select core.purga_pausar()`);
  t('pausar quita la tarea y apaga la purga', Number(await uno(`select count(*) from cron.job where jobname = 'prodmazul-purga-fotos'`)) === 0 && (await uno(`select valor from core.config where clave = 'purga_activa'`)) === false);
  await db.exec(`delete from vault.secrets where name in ('sync_funcion_url','sync_secreto')`);
  await db.query(`select core.purga_disparar('cron')`);
  t('la tarea sin secretos NO falla: deja la corrida anotada con error', (await q(`select estado, error from core.purga_ejecuciones order by purga_id desc limit 1`))[0].estado === 'con_error');
  const sinSec = await db.query(`select core.purga_disparar('manual')`).then(() => 'ok', (e) => e.message);
  t('«purgar ahora» sin secretos da un mensaje claro', sinSec.startsWith('E_CONFIG'));
}

// ---------------------------------------------------------------- 10) la función con la acción «purgar»
console.log('\nFunción sync-exportar · acción «purgar»');
{
  let manejador = null;
  globalThis.Deno = { serve: (fn) => { manejador = fn; }, env: { get: (n) => ({ ...entorno, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(30) })[n] } };
  await import('../../supabase/functions/sync-exportar/index.ts?otra=1').catch(() => null);
  if (manejador) {
    const pedir = async (cab, cuerpo) => { const r = await manejador(new Request('https://x.supabase.co/functions/v1/sync-exportar', { method: 'POST', headers: cab, body: JSON.stringify(cuerpo) })); return { estado: r.status, json: await r.json() }; };
    let r = await pedir({}, { accion: 'purgar' });
    t('purgar sin el secreto: 401', r.estado === 401);
    r = await pedir({ 'x-sync-secreto': SECRETO }, { accion: 'purgar', origen: 'cron' });
    t('con el secreto responde 200 con un resultado (aquí el doble de Supabase no tiene base)', r.estado === 200 && typeof r.json.ok === 'boolean');
  } else { t('la función se carga', false); }
}

console.log(`\nResultado: ${ok} correctas, ${mal} con fallo`);
process.exit(mal ? 1 : 0);
