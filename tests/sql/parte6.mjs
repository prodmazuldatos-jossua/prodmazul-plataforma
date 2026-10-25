// Pruebas de la Parte 6: acumulado de un lote (api_obtener_lote).
// Aplica TODAS las migraciones (Partes 1, 2, 4, 5 y 6) en una base PostgreSQL simulada (PGlite).
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(aqui, '../../supabase/migrations');
const db = new PGlite();
const ADMIN = '00000000-0000-0000-0000-000000000001';
const OPER = '00000000-0000-0000-0000-000000000002';
const OPER2 = '00000000-0000-0000-0000-000000000003';
const CONS = '00000000-0000-0000-0000-000000000004';

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true),'')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  grant usage on schema public to anon, authenticated;
`);
let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, extra); } };
const como = async (uid, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub','${uid}',false);`);
  try { return { r: await db.query(sql, params) }; } catch (e) { return { e: e.message }; } finally { await db.exec('reset role;'); }
};
const api = async (uid, fn, ...args) => {
  const ph = args.map((_, i) => `$${i + 1}${typeof args[i] === 'object' && args[i] !== null ? '::jsonb' : ''}`).join(',');
  const x = await como(uid, `select public.${fn}(${ph}) as r`, args.map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : a)));
  return x.e ? { e: x.e } : { r: x.r.rows[0].r };
};
const err = (x, c) => !!x.e && x.e.startsWith(c + '|');

console.log('\nMigraciones');
for (const f of fs.readdirSync(dir).sort()) {
  try { await db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); ok('se aplica ' + f, true); }
  catch (e) { ok('se aplica ' + f, false, e.message); process.exit(1); }
}
await db.exec(`
  insert into auth.users(id,email) values ('${ADMIN}','admin@x.com'),('${OPER}','op@x.com'),('${OPER2}','op2@x.com'),('${CONS}','co@x.com');
  update core.perfiles set es_admin_general = true, nombre = 'Admin' where user_id = '${ADMIN}';
  insert into core.usuario_modulo_rol values ('${OPER}','M01','operativo'),('${OPER2}','M01','operativo'),('${CONS}','M01','consulta');
`);
const hoy = (await db.query(`select (now() at time zone 'America/Guayaquil')::date as d`)).rows[0].d.toISOString().slice(0, 10);
const nueva = (guia, extra = {}) => ({
  client_uuid: crypto.randomUUID(), estado: 'cerrado', fecha_llegada: hoy, lote_id: '123-456-789', proveedor: 'Prov', especie: 'Esp',
  guia_remision: guia, num_gavetas_bines: 1, libras_reportadas: 100, libras_planta: 99, gavetas: [{ num_gaveta: 1, peso_lb: 50 }], ...extra });
const crear = async (uid, guia, extra) => (await api(uid, 'api_m01_guardar_recepcion', nueva(guia, extra))).r;
const ver = async (id, uid = ADMIN) => (await api(uid, 'api_m01_obtener_recepcion', id)).r;

console.log('\nAcumulado del lote');
const lote = async (uid, l) => (await api(uid, 'api_obtener_lote', l));
let x = await lote(OPER, '123-456-789');
ok('un lote que no existe devuelve existe=false y acumulado en 0', x.r?.existe === false && x.r?.camiones === 0 && Number(x.r?.libras_planta) === 0, JSON.stringify(x));
const a1 = await crear(OPER, 'G-1', { libras_reportadas: 1000, libras_planta: 990 });
x = await lote(OPER, '123-456-789');
ok('con una recepción: 1 camión y sus libras', x.r?.existe && x.r?.camiones === 1 && Number(x.r.libras_reportadas) === 1000 && Number(x.r.libras_planta) === 990, JSON.stringify(x));
const a2 = await crear(OPER2, 'G-2', { libras_reportadas: 500, libras_planta: 495 });
x = await lote(OPER, '123-456-789');
ok('con dos recepciones suma camiones y libras', x.r?.camiones === 2 && Number(x.r.libras_reportadas) === 1500 && Number(x.r.libras_planta) === 1485, JSON.stringify(x));
await crear(OPER, 'G-3', { estado: 'borrador', libras_reportadas: 100, libras_planta: null, gavetas: [] });
x = await lote(OPER, '123-456-789');
ok('un borrador cuenta (aunque no tenga libras de planta)', x.r?.camiones === 3 && Number(x.r.libras_planta) === 1485 && Number(x.r.libras_reportadas) === 1600, JSON.stringify(x));
await api(OPER, 'api_m01_anular', a1.recepcion_id, 'error de digitación', 1);
x = await lote(OPER, '123-456-789');
ok('una anulada deja de sumar', x.r?.camiones === 2 && Number(x.r.libras_planta) === 495, JSON.stringify(x));
await api(ADMIN, 'api_m01_eliminar', a2.recepcion_id, 'retirada por gerencia', 1);
x = await lote(OPER, '123-456-789');
ok('una eliminada deja de sumar', x.r?.camiones === 1 && Number(x.r.libras_planta) === 0, JSON.stringify(x));
await api(ADMIN, 'api_m01_reactivar', a1.recepcion_id, 2);
x = await lote(OPER, '123-456-789');
ok('al reactivar vuelve a sumar', x.r?.camiones === 2 && Number(x.r.libras_planta) === 990, JSON.stringify(x));
ok('conserva proveedor y especie', x.r?.proveedor_nombre === 'Prov' && x.r?.especie_nombre === 'Esp');
ok('el lote se normaliza a mayúsculas', (await lote(OPER, '111-222-333a')).r?.lote_id === '111-222-333A');
ok('un lote con formato inválido da E_VALIDACION', err(await lote(OPER, '12-34'), 'E_VALIDACION'));
ok('consulta (solo lectura) puede consultar el acumulado', !!(await lote(CONS, '123-456-789')).r);
ok('un usuario sin rol no puede (E_PERMISO)', err(await lote('00000000-0000-0000-0000-0000000000ff', '123-456-789'), 'E_PERMISO'));
const pri = await db.query(`select has_function_privilege('anon', p.oid,'execute') anon, has_function_privilege('authenticated', p.oid,'execute') aut from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='api_obtener_lote'`);
ok('sigue ejecutable solo con sesión', pri.rows.length === 1 && pri.rows[0].aut && !pri.rows[0].anon);

console.log(`\nRESULTADO: ${pass} correctas, ${fail} con fallo.`);
process.exit(fail ? 1 : 0);
