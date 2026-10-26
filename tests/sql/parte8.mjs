// Pruebas de la Parte 8: listado ampliado, edición y cambios de estado.
// Aplica TODAS las migraciones (1 a 10) en una base PostgreSQL simulada (PGlite).
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
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
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
const nuevaR = (guia, extra = {}) => ({
  client_uuid: crypto.randomUUID(), estado: 'cerrado', fecha_llegada: hoy, lote_id: '123-456-789', proveedor: 'Prov', especie: 'Esp',
  guia_remision: guia, llegada_en: 'gavetas', num_gavetas_bines: 3, libras_reportadas: 1000, libras_planta: 990,
  gavetas: [{ num_gaveta: 1, peso_lb: 50 }, { num_gaveta: 2, peso_lb: 49 }], temperaturas: [{ lectura_id: 1, num_gaveta: 2, temperatura_c: 2.5 }], ...extra });
const crear = async (uid, guia, extra) => (await api(uid, 'api_m01_guardar_recepcion', nuevaR(guia, extra))).r;
const ver = async (id, uid = ADMIN) => (await api(uid, 'api_m01_obtener_recepcion', id)).r;
const lista = async (uid, p = {}) => (await api(uid, 'api_m01_listar_recepciones', p));

console.log('\nListado con los datos nuevos');
const r1 = await crear(OPER, 'G-1');
const r2 = await crear(OPER2, 'G-2', { fecha_llegada: '2026-01-15', lote_id: '111-222-333', proveedor: 'Otro Proveedor', llegada_en: 'bines' });
const r3 = await crear(OPER, 'G-3', { estado: 'borrador', lote_id: '555-666-777', libras_planta: null, gavetas: [], temperaturas: [] });
let l = await lista(CONS);
const it = (id) => l.r?.items?.find((i) => i.recepcion_id === id);
ok('el listado trae llegada_en, creado_por, lote_cerrado y motivo_anulacion', it(r1.recepcion_id)?.llegada_en === 'gavetas' && it(r1.recepcion_id)?.creado_por === OPER
   && it(r1.recepcion_id)?.lote_cerrado === false && 'motivo_anulacion' in it(r1.recepcion_id), JSON.stringify(it(r1.recepcion_id)));
ok('una recepción en bines lo indica', it(r2.recepcion_id)?.llegada_en === 'bines');
ok('el listado normal muestra borradores y cerradas (3)', l.r?.total === 3, JSON.stringify(l.r?.total));
l = await lista(CONS, { estado: 'borrador' });
ok('el filtro «borrador» deja solo el borrador', l.r?.total === 1 && l.r.items[0].recepcion_id === r3.recepcion_id);
l = await lista(CONS, { estado: 'cerrado' });
ok('el filtro «cerrado» deja 2', l.r?.total === 2);
l = await lista(CONS, { busqueda: 'otro prov' });
ok('la búsqueda por proveedor (sin importar mayúsculas) encuentra 1', l.r?.total === 1 && l.r.items[0].recepcion_id === r2.recepcion_id);
l = await lista(CONS, { busqueda: 'g-3' });
ok('la búsqueda por guía encuentra la recepción', l.r?.total === 1 && l.r.items[0].recepcion_id === r3.recepcion_id);
l = await lista(CONS, { busqueda: '111-222-333' });
ok('la búsqueda por lote funciona', l.r?.total === 1);
l = await lista(CONS, { desde: '2026-01-01', hasta: '2026-01-31' });
ok('el rango de fechas deja solo enero', l.r?.total === 1 && l.r.items[0].recepcion_id === r2.recepcion_id);
l = await lista(CONS, { limite: 2, desplazamiento: 0 });
const pag1 = l.r?.items?.map((i) => i.recepcion_id) ?? [];
l = await lista(CONS, { limite: 2, desplazamiento: 2 });
const pag2 = l.r?.items?.map((i) => i.recepcion_id) ?? [];
ok('la paginación reparte 2 + 1 sin repetir', pag1.length === 2 && pag2.length === 1 && !pag2.some((i) => pag1.includes(i)) && l.r.total === 3);
l = await lista(CONS, { estado: 'inventado' });
ok('un filtro de estado inválido da E_VALIDACION', err(l, 'E_VALIDACION'), l.e);
l = await lista(CONS, { desde: 'ayer' });
ok('una fecha inválida da E_VALIDACION', err(l, 'E_VALIDACION'), l.e);
l = await lista(CONS, { estado: 'eliminado' });
ok('consulta no puede pedir «eliminado»', err(l, 'E_PERMISO'), l.e);

console.log('\nEditar');
let g = await api(OPER, 'api_m01_guardar_recepcion', nuevaR('G-1', { recepcion_id: r1.recepcion_id, version: r1.version, observacion: 'editada', libras_planta: 980 }));
ok('el autor edita su recepción cerrada y sube la versión', g.r?.version === r1.version + 1 && g.r?.estado === 'cerrado', JSON.stringify(g));
let d = await ver(r1.recepcion_id);
ok('el detalle muestra lo editado y el autor no cambia', d.observacion === 'editada' && Number(d.libras_planta) === 980 && d.creado_por === OPER && d.llegada_en === 'gavetas');
ok('el detalle trae gavetas, temperatura por gaveta y lote_cerrado', d.gavetas.length === 2 && d.temperaturas[0].num_gaveta === 2 && d.lote_cerrado === false);
g = await api(OPER, 'api_m01_guardar_recepcion', nuevaR('G-1', { recepcion_id: r1.recepcion_id, version: r1.version }));
ok('editar con una versión vieja da E_VERSION', err(g, 'E_VERSION'), g.e);
g = await api(OPER2, 'api_m01_guardar_recepcion', nuevaR('G-1', { recepcion_id: r1.recepcion_id, version: g.r?.version ?? d.version }));
ok('otro operativo no puede editar lo ajeno (E_PERMISO)', err(g, 'E_PERMISO'), g.e);
g = await api(CONS, 'api_m01_guardar_recepcion', nuevaR('G-1', { recepcion_id: r1.recepcion_id, version: d.version }));
ok('consulta no puede editar (E_PERMISO)', err(g, 'E_PERMISO'), g.e);
g = await api(ADMIN, 'api_m01_guardar_recepcion', nuevaR('G-1', { recepcion_id: r1.recepcion_id, version: d.version, observacion: 'por admin' }));
ok('el administrador edita recepciones ajenas', g.r?.version === d.version + 1, JSON.stringify(g));
g = await api(OPER, 'api_m01_guardar_recepcion', nuevaR('G-3', { recepcion_id: r3.recepcion_id, version: r3.version, estado: 'cerrado', libras_planta: 80,
  gavetas: [{ num_gaveta: 1, peso_lb: 40 }], temperaturas: [] }));
ok('un borrador editado puede pasar a cerrado', g.r?.estado === 'cerrado', JSON.stringify(g));

console.log('\nLote cerrado y edición');
d = await ver(r1.recepcion_id);
g = await api(OPER, 'api_m01_guardar_recepcion', nuevaR('G-1', { recepcion_id: r1.recepcion_id, version: d.version, cerrar_lote: true }));
ok('al editar se puede cerrar el lote', g.r?.lote_cerrado === true, JSON.stringify(g));
d = await ver(r1.recepcion_id);
ok('el detalle indica que el lote está cerrado', d.lote_cerrado === true);
g = await api(OPER, 'api_m01_guardar_recepcion', nuevaR('G-1', { recepcion_id: r1.recepcion_id, version: d.version, observacion: 'después de cerrar el lote' }));
ok('una recepción de un lote cerrado SÍ se puede seguir editando', g.r?.version === d.version + 1, JSON.stringify(g));
const nn = await api(OPER, 'api_m01_guardar_recepcion', nuevaR('G-NUEVA'));
ok('recepción nueva en lote cerrado da E_ESTADO', err(nn, 'E_ESTADO'), nn.e);
d = await ver(r2.recepcion_id);
g = await api(OPER2, 'api_m01_guardar_recepcion', nuevaR('G-2', { recepcion_id: r2.recepcion_id, version: d.version, lote_id: '123-456-789' }));
ok('mover una recepción a un lote cerrado da E_ESTADO', err(g, 'E_ESTADO'), g.e);
l = await lista(CONS, { busqueda: '123-456-789' });
ok('el listado marca lote_cerrado=true', l.r?.items?.every((i) => i.lote_cerrado === true) && l.r.total >= 1);

console.log('\nAnular, eliminar y reactivar');
d = await ver(r2.recepcion_id);
let e = await api(OPER2, 'api_m01_anular', r2.recepcion_id, 'abc', d.version);
ok('un motivo de menos de 5 caracteres se rechaza', err(e, 'E_VALIDACION'), e.e);
e = await api(OPER, 'api_m01_anular', r2.recepcion_id, 'no es mía, no debería', d.version);
ok('otro operativo no puede anular lo ajeno', err(e, 'E_PERMISO'), e.e);
e = await api(CONS, 'api_m01_anular', r2.recepcion_id, 'consulta no puede', d.version);
ok('consulta no puede anular', err(e, 'E_PERMISO'), e.e);
e = await api(OPER2, 'api_m01_anular', r2.recepcion_id, 'guía mal digitada', d.version - 1);
ok('anular con versión vieja da E_VERSION', err(e, 'E_VERSION'), e.e);
e = await api(OPER2, 'api_m01_anular', r2.recepcion_id, 'guía mal digitada', d.version);
ok('el autor anula su recepción', e.r?.estado === 'anulado' && e.r?.version === d.version + 1, JSON.stringify(e));
d = await ver(r2.recepcion_id);
ok('el detalle guarda el motivo y el estado previo', d.motivo_anulacion === 'guía mal digitada' && d.estado_previo === 'cerrado' && d.estado === 'anulado');
g = await api(OPER2, 'api_m01_guardar_recepcion', nuevaR('G-2', { recepcion_id: r2.recepcion_id, version: d.version }));
ok('una anulada no se edita (E_ESTADO)', err(g, 'E_ESTADO'), g.e);
l = await lista(CONS, { estado: 'anulado' });
ok('el filtro «anulado» la muestra con su motivo', l.r?.total === 1 && l.r.items[0].motivo_anulacion === 'guía mal digitada');
l = await lista(CONS);
ok('el listado normal ya no la muestra', !l.r.items.some((i) => i.recepcion_id === r2.recepcion_id));
e = await api(OPER2, 'api_m01_reactivar', r2.recepcion_id, d.version);
ok('un operativo no puede reactivar (E_PERMISO)', err(e, 'E_PERMISO'), e.e);
e = await api(ADMIN, 'api_m01_reactivar', r2.recepcion_id, d.version);
ok('el administrador reactiva y vuelve a cerrada', e.r?.estado === 'cerrado', JSON.stringify(e));
d = await ver(r2.recepcion_id);
e = await api(OPER2, 'api_m01_eliminar', r2.recepcion_id, 'quiero borrarla', d.version);
ok('un operativo no puede eliminar (E_PERMISO)', err(e, 'E_PERMISO'), e.e);
e = await api(ADMIN, 'api_m01_eliminar', r2.recepcion_id, 'duplicada por error', d.version);
ok('el administrador elimina con motivo', e.r?.estado === 'eliminado', JSON.stringify(e));
let x = await api(OPER2, 'api_m01_obtener_recepcion', r2.recepcion_id);
ok('una eliminada no la ve el operativo (E_NO_ENCONTRADO)', err(x, 'E_NO_ENCONTRADO'), x.e);
x = await ver(r2.recepcion_id, ADMIN);
ok('el administrador sí la ve eliminada', x.estado === 'eliminado');
l = await lista(ADMIN, { estado: 'eliminado' });
ok('el filtro «eliminado» del administrador la muestra', l.r?.total === 1);
l = await lista(ADMIN, { estado: 'todos' });
ok('«todos» del administrador incluye eliminadas', l.r.items.some((i) => i.recepcion_id === r2.recepcion_id));
l = await lista(OPER, { estado: 'todos' });
ok('«todos» de un operativo no incluye eliminadas', !l.r.items.some((i) => i.recepcion_id === r2.recepcion_id));
e = await api(ADMIN, 'api_m01_reactivar', r2.recepcion_id, x.version);
ok('el administrador reactiva la eliminada', e.r?.estado === 'cerrado', JSON.stringify(e));
const aud = (await db.query(`select accion, count(*)::int as n from core.auditoria where modulo_id='M01' and entidad='recepcion' and accion in ('anular','eliminar','reactivar') group by accion order by accion`)).rows;
ok('queda auditoría de anular, eliminar y reactivar', aud.length === 3 && aud.find((a) => a.accion === 'reactivar')?.n === 2, JSON.stringify(aud));

console.log(`\nResultado: ${pass} correctas, ${fail} con fallo.`);
process.exit(fail ? 1 : 0);
