// Pruebas de la Parte 5: anular, eliminar y reactivar recepciones.
// Aplica TODAS las migraciones (Partes 1, 2, 4 y 5) en una base PostgreSQL simulada (PGlite).
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

console.log('\nSeguridad');
const pri = await db.query(`select p.proname, has_function_privilege('anon', p.oid,'execute') anon, has_function_privilege('authenticated', p.oid,'execute') aut
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('api_m01_anular','api_m01_eliminar','api_m01_reactivar')`);
ok('existen las 3 funciones', pri.rows.length === 3);
ok('solo con sesión (anon no)', pri.rows.every((x) => x.aut && !x.anon));
const r0 = await crear(OPER, 'G-1');
ok('la función interna no se puede llamar desde la API', !!(await como(OPER, `select m01_recepcion.cargar_para_cambio('${r0.recepcion_id}', 1)`)).e);

console.log('\nAnular');
ok('consulta no puede anular', err(await api(CONS, 'api_m01_anular', r0.recepcion_id, 'motivo valido', 1), 'E_PERMISO'));
ok('otro operativo no puede anular lo ajeno', err(await api(OPER2, 'api_m01_anular', r0.recepcion_id, 'motivo valido', 1), 'E_PERMISO'));
ok('el motivo es obligatorio', err(await api(OPER, 'api_m01_anular', r0.recepcion_id, '', 1), 'E_VALIDACION'));
ok('un motivo de menos de 5 caracteres se rechaza', err(await api(OPER, 'api_m01_anular', r0.recepcion_id, ' abc ', 1), 'E_VALIDACION'));
ok('un motivo de más de 500 caracteres se rechaza', err(await api(OPER, 'api_m01_anular', r0.recepcion_id, 'x'.repeat(501), 1), 'E_VALIDACION'));
ok('con una versión vieja da E_VERSION', err(await api(OPER, 'api_m01_anular', r0.recepcion_id, 'motivo valido', 7), 'E_VERSION'));
ok('sin versión da E_VERSION', err(await api(OPER, 'api_m01_anular', r0.recepcion_id, 'motivo valido', null), 'E_VERSION'));
ok('una recepción inexistente da E_NO_ENCONTRADO', err(await api(OPER, 'api_m01_anular', 'REC-20200101-0001', 'motivo valido', 1), 'E_NO_ENCONTRADO'));
const a1 = await api(OPER, 'api_m01_anular', r0.recepcion_id, '  Guía mal digitada  ', 1);
ok('el creador anula: estado anulado y versión 2', a1.r?.estado === 'anulado' && a1.r?.version === 2, JSON.stringify(a1));
let o = await ver(r0.recepcion_id);
ok('quedan motivo (sin espacios sobrantes), quién y cuándo', o.motivo_anulacion === 'Guía mal digitada' && o.anulado_por === OPER && !!o.anulado_en && o.estado_previo === 'cerrado');
ok('el listado normal ya no la muestra', (await api(OPER, 'api_m01_listar_recepciones', {})).r.total === 0);
ok('el filtro «anulado» sí', (await api(OPER, 'api_m01_listar_recepciones', { estado: 'anulado' })).r.total === 1);
ok('una anulada no se puede editar (E_ESTADO)', err(await api(OPER, 'api_m01_guardar_recepcion', { ...nueva('G-1'), recepcion_id: r0.recepcion_id, version: 2 }), 'E_ESTADO'));
ok('anular dos veces da E_ESTADO', err(await api(OPER, 'api_m01_anular', r0.recepcion_id, 'otra vez aqui', 2), 'E_ESTADO'));
ok('la guía de una anulada sigue ocupada', err(await api(OPER2, 'api_m01_guardar_recepcion', nueva('G-1')), 'E_DUPLICADO'));
ok('queda en la auditoría', Number((await db.query(`select count(*) c from core.auditoria where accion='anular' and entidad_id='${r0.recepcion_id}'`)).rows[0].c) === 1);
const rb = await crear(OPER, 'G-2', { estado: 'borrador', libras_planta: null, gavetas: [] });
ok('un borrador también se puede anular y recuerda que era borrador', (await api(OPER, 'api_m01_anular', rb.recepcion_id, 'duplicado por error', 1)).r?.estado === 'anulado' && (await ver(rb.recepcion_id)).estado_previo === 'borrador');
const rc = await crear(OPER, 'G-3');
ok('el administrador general puede anular lo ajeno', (await api(ADMIN, 'api_m01_anular', rc.recepcion_id, 'revisión de gerencia', 1)).r?.estado === 'anulado');

console.log('\nEliminar');
ok('un operativo no puede eliminar', err(await api(OPER, 'api_m01_eliminar', r0.recepcion_id, 'motivo valido', 2), 'E_PERMISO'));
ok('consulta no puede eliminar', err(await api(CONS, 'api_m01_eliminar', r0.recepcion_id, 'motivo valido', 2), 'E_PERMISO'));
ok('eliminar exige motivo', err(await api(ADMIN, 'api_m01_eliminar', r0.recepcion_id, '   ', 2), 'E_VALIDACION'));
ok('eliminar con versión vieja da E_VERSION', err(await api(ADMIN, 'api_m01_eliminar', r0.recepcion_id, 'limpieza de prueba', 1), 'E_VERSION'));
const e1 = await api(ADMIN, 'api_m01_eliminar', r0.recepcion_id, 'limpieza de prueba', 2);
ok('el administrador elimina una anulada: estado eliminado, versión 3', e1.r?.estado === 'eliminado' && e1.r?.version === 3, JSON.stringify(e1));
o = await ver(r0.recepcion_id);
ok('se conserva el motivo de la anulación y se registra quién eliminó', o.motivo_anulacion === 'Guía mal digitada' && o.eliminado_por === ADMIN && !!o.eliminado_en);
ok('eliminar dos veces da E_ESTADO', err(await api(ADMIN, 'api_m01_eliminar', r0.recepcion_id, 'otra vez aqui', 3), 'E_ESTADO'));
ok('el operativo ya no la ve (E_NO_ENCONTRADO)', err(await api(OPER, 'api_m01_obtener_recepcion', r0.recepcion_id), 'E_NO_ENCONTRADO'));
ok('el operativo tampoco puede cambiarla (E_NO_ENCONTRADO)', err(await api(OPER, 'api_m01_anular', r0.recepcion_id, 'motivo valido', 3), 'E_NO_ENCONTRADO'));
ok('el filtro «todos» no la muestra al operativo', (await api(OPER, 'api_m01_listar_recepciones', { estado: 'todos' })).r.items.every((x) => x.recepcion_id !== r0.recepcion_id));
ok('el administrador la ve con el filtro «eliminado»', (await api(ADMIN, 'api_m01_listar_recepciones', { estado: 'eliminado' })).r.total === 1);
const rd = await crear(OPER, 'G-4');
ok('se puede eliminar una cerrada directamente', (await api(ADMIN, 'api_m01_eliminar', rd.recepcion_id, 'registro duplicado', 1)).r?.estado === 'eliminado');
ok('la recepción sigue existiendo físicamente (nada se borra)', Number((await db.query(`select count(*) c from m01_recepcion.recepciones`)).rows[0].c) === 4);
ok('la base impide el borrado físico', !!(await db.query(`delete from m01_recepcion.recepciones where recepcion_id='${rd.recepcion_id}'`).then(() => null, (e) => e.message)));

console.log('\nReactivar');
ok('un operativo no puede reactivar', err(await api(OPER, 'api_m01_reactivar', rb.recepcion_id, 2), 'E_PERMISO'));
ok('reactivar con versión vieja da E_VERSION', err(await api(ADMIN, 'api_m01_reactivar', rb.recepcion_id, 1), 'E_VERSION'));
const re1 = await api(ADMIN, 'api_m01_reactivar', rb.recepcion_id, 2);
o = await ver(rb.recepcion_id);
ok('una anulada que era borrador vuelve a borrador y limpia la anulación', re1.r?.estado === 'borrador' && o.estado === 'borrador' && o.motivo_anulacion === null && o.anulado_en === null && o.estado_previo === null);
ok('tras reactivar se puede editar de nuevo', !!(await api(OPER, 'api_m01_guardar_recepcion', { ...nueva('G-2', { observacion: 'ok' }), recepcion_id: rb.recepcion_id, version: re1.r.version })).r);
ok('reactivar una que no está anulada ni eliminada da E_ESTADO', err(await api(ADMIN, 'api_m01_reactivar', rb.recepcion_id, 4), 'E_ESTADO'));
const re2 = await api(ADMIN, 'api_m01_reactivar', rd.recepcion_id, 2);
ok('una eliminada que estaba cerrada vuelve a cerrada', re2.r?.estado === 'cerrado' && (await ver(rd.recepcion_id)).eliminado_en === null);
const re3 = await api(ADMIN, 'api_m01_reactivar', r0.recepcion_id, 3);
o = await ver(r0.recepcion_id);
ok('una eliminada que antes estaba anulada vuelve a anulada, con su motivo', re3.r?.estado === 'anulado' && o.motivo_anulacion === 'Guía mal digitada' && o.eliminado_en === null);
const re4 = await api(ADMIN, 'api_m01_reactivar', r0.recepcion_id, 4);
ok('y al reactivarla otra vez vuelve a cerrada', re4.r?.estado === 'cerrado' && (await ver(r0.recepcion_id)).motivo_anulacion === null, JSON.stringify(re4));
ok('el operativo la vuelve a ver en el listado normal', (await api(OPER, 'api_m01_listar_recepciones', {})).r.items.some((x) => x.recepcion_id === r0.recepcion_id));
ok('queda en la auditoría', Number((await db.query(`select count(*) c from core.auditoria where accion in ('reactivar','eliminar','anular')`)).rows[0].c) >= 8);

console.log('\nConcurrencia');
const rx = await crear(OPER, 'G-5');
const par = await Promise.all([api(OPER, 'api_m01_anular', rx.recepcion_id, 'motivo valido', 1), api(ADMIN, 'api_m01_eliminar', rx.recepcion_id, 'motivo valido', 1)]);
ok('dos cambios simultáneos con la misma versión: solo uno prospera', par.filter((x) => x.r).length === 1 && par.filter((x) => err(x, 'E_VERSION') || err(x, 'E_ESTADO')).length === 1, JSON.stringify(par));

console.log(`\nRESULTADO: ${pass} correctas, ${fail} con fallo.`);
process.exit(fail ? 1 : 0);
