// Pruebas de la Parte 9: fotos (funciones, cupos y políticas de almacenamiento).
// Aplica TODAS las migraciones (1 a 11) en una base PostgreSQL simulada (PGlite).
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

await db.exec(`
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select, insert, delete on storage.objects to authenticated;
`);
const nuevaR = (guia, extra = {}) => ({
  client_uuid: crypto.randomUUID(), estado: 'cerrado', fecha_llegada: hoy, lote_id: '123-456-789', proveedor: 'Prov', especie: 'Esp',
  guia_remision: guia, llegada_en: 'bines', num_gavetas_bines: 3, libras_reportadas: 100, libras_planta: 99,
  gavetas: [{ num_gaveta: 1, peso_lb: 50 }], ...extra });
const crear = async (uid, guia, extra) => (await api(uid, 'api_m01_guardar_recepcion', nuevaR(guia, extra))).r;
const BK = 'm01-recepcion-fotos';
// Simula la subida del archivo (lo que hace la aplicación con el cliente de almacenamiento, sujeta a las políticas).
const subir = async (uid, ruta) => como(uid, `insert into storage.objects (bucket_id, name) values ($1, $2)`, [BK, ruta]);
const existeObj = async (ruta) => (await db.query(`select count(*)::int n from storage.objects where bucket_id=$1 and name=$2`, [BK, ruta])).rows[0].n;
const veo = async (uid, ruta) => { const x = await como(uid, `select count(*)::int n from storage.objects where bucket_id=$1 and name=$2`, [BK, ruta]); return x.r?.rows[0].n ?? -1; };
const borro = async (uid, ruta) => { const x = await como(uid, `delete from storage.objects where bucket_id=$1 and name=$2`, [BK, ruta]); return x.e ? -1 : x.r.affectedRows; };
const reg = (uid, id, nombre = 'foto.jpg', mime = 'image/jpeg', tam = 1000) => api(uid, 'api_m01_registrar_foto', id, nombre, mime, tam);
const fotosEnBase = async (id) => (await db.query(`select count(*)::int n from m01_recepcion.fotos_meta where recepcion_id=$1`, [id])).rows[0].n;

console.log('\nBucket');
const b = (await db.query(`select * from storage.buckets where id=$1`, [BK])).rows[0];
ok('el bucket existe y es privado', b && b.public === false);
ok('límite de 5 MB y solo JPEG, PNG o WebP', Number(b.file_size_limit) === 5242880 && b.allowed_mime_types.join() === 'image/jpeg,image/png,image/webp');
ok('hay tres políticas sobre el almacenamiento (subir, ver, borrar)', (await db.query(`select count(*)::int n from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'm01_fotos_%'`)).rows[0].n === 3);

console.log('\nRegistrar');
const A = await crear(OPER, 'F-1'); // creada por OPER
const idA = A.recepcion_id;
let x = await reg(OPER, idA);
ok('el autor registra una foto y recibe identificador, número y ruta', x.r?.nn === 1 && x.r.foto_id === `FOT-M01-123-456-789-${idA}-01` && x.r.ruta.startsWith(`M01/123-456-789/${idA}/FOT-M01-`) && x.r.ruta.endsWith('.jpg'), JSON.stringify(x));
const f1 = x.r;
x = await reg(OPER, idA, 'a.png', 'image/png');
ok('la segunda foto toma el cupo 2 y respeta el tipo (png)', x.r?.nn === 2 && x.r.ruta.endsWith('.png'), JSON.stringify(x));
const f2 = x.r;
x = await reg(OPER, idA, 'b.webp', 'image/webp');
ok('webp también se admite', x.r?.nn === 3 && x.r.ruta.endsWith('.webp'));
x = await reg(OPER, idA, 'c.jpg'); const f4 = x.r;
x = await reg(OPER, idA, 'd.jpg'); const f5 = x.r;
ok('se registran 5 cupos', f4?.nn === 4 && f5?.nn === 5);
x = await reg(OPER, idA);
ok('la sexta foto se rechaza (E_FOTOS)', err(x, 'E_FOTOS'), x.e);
ok('sigue habiendo 5 registros', (await fotosEnBase(idA)) === 5);
x = await reg(OPER, idA, 'x.gif', 'image/gif');
ok('un tipo que no es imagen admitida se rechaza', err(x, 'E_VALIDACION') || err(x, 'E_FOTOS'), x.e);
x = await reg(OPER, idA, 'x.jpg', 'image/jpeg', 6 * 1024 * 1024);
ok('más de 5 MB se rechaza', err(x, 'E_VALIDACION') || err(x, 'E_FOTOS'), x.e);
x = await reg(OPER, 'REC-NO-EXISTE');
ok('una recepción que no existe da E_NO_ENCONTRADO', err(x, 'E_NO_ENCONTRADO'), x.e);

console.log('\nPermisos al registrar');
const B = await crear(OPER2, 'F-2', { lote_id: '222-333-444' }); const idB = B.recepcion_id;
x = await reg(OPER, idB);
ok('otro operativo no agrega fotos a una recepción ajena (E_PERMISO)', err(x, 'E_PERMISO'), x.e);
x = await reg(CONS, idB);
ok('consulta no agrega fotos (E_PERMISO)', err(x, 'E_PERMISO'), x.e);
x = await reg(ADMIN, idB);
ok('el administrador sí agrega fotos a lo ajeno', x.r?.nn === 1, JSON.stringify(x));
const fB = x.r;
const fl = await api(ADMIN, 'api_m01_obtener_recepcion', idB);
await api(OPER2, 'api_m01_anular', idB, 'prueba de anulación', fl.r.version);
x = await reg(OPER2, idB);
ok('una anulada no admite fotos (E_ESTADO)', err(x, 'E_ESTADO'), x.e);

console.log('\nSubir, confirmar y ver');
x = await api(OPER, 'api_m01_confirmar_foto', f1.foto_id);
ok('confirmar sin haber subido el archivo se rechaza (E_FOTOS)', err(x, 'E_FOTOS'), x.e);
x = await subir(OPER, 'M01/123-456-789/otra/ruta-no-registrada.jpg');
ok('subir a una ruta NO registrada se rechaza por la política', !!x.e, JSON.stringify(x.r?.affectedRows));
x = await subir(OPER2, f1.ruta);
ok('otro usuario no puede subir a una ruta registrada por alguien más', !!x.e);
x = await subir(CONS, f1.ruta);
ok('consulta no puede subir', !!x.e);
x = await subir(OPER, f1.ruta);
ok('el autor sube el archivo a su ruta registrada', !x.e && (await existeObj(f1.ruta)) === 1, x.e);
ok('antes de confirmar, otro usuario NO ve el archivo', (await veo(OPER2, f1.ruta)) === 0);
ok('antes de confirmar, quien lo subió sí lo ve', (await veo(OPER, f1.ruta)) === 1);
x = await api(OPER, 'api_m01_confirmar_foto', f1.foto_id);
ok('confirmar tras subir funciona', x.r?.confirmada === true, JSON.stringify(x));
x = await api(OPER, 'api_m01_confirmar_foto', f1.foto_id);
ok('confirmar dos veces es seguro (idempotente)', x.r?.confirmada === true);
x = await api(OPER2, 'api_m01_confirmar_foto', f2.foto_id);
ok('otro operativo no confirma una foto ajena (E_PERMISO)', err(x, 'E_PERMISO'), x.e);
ok('confirmada, consulta (con permiso ver) la puede ver', (await veo(CONS, f1.ruta)) === 1);
ok('una ruta no registrada no se ve', (await veo(CONS, 'M01/x/y/z.jpg')) === 0);
x = await api(CONS, 'api_m01_fotos_recepcion', idA);
ok('el listado de fotos solo trae las confirmadas (1) con su ruta', x.r?.length === 1 && x.r[0].ruta === f1.ruta && x.r[0].nn === 1, JSON.stringify(x));
x = await api(CONS, 'api_m01_obtener_recepcion', idA);
ok('el detalle de la recepción cuenta solo las confirmadas', x.r?.fotos?.length === 1);

console.log('\nBorrar y reutilizar cupos');
ok('consulta no puede borrar el archivo', (await borro(CONS, f1.ruta)) <= 0 && (await existeObj(f1.ruta)) === 1);
ok('otro operativo no puede borrar el archivo', (await borro(OPER2, f1.ruta)) <= 0 && (await existeObj(f1.ruta)) === 1);
x = await api(OPER2, 'api_m01_eliminar_foto', f1.foto_id);
ok('otro operativo no elimina el registro (E_PERMISO)', err(x, 'E_PERMISO'), x.e);
ok('el autor borra el archivo del almacenamiento', (await borro(OPER, f1.ruta)) === 1 && (await existeObj(f1.ruta)) === 0);
x = await api(OPER, 'api_m01_eliminar_foto', f1.foto_id);
ok('el autor elimina el registro y libera el cupo', x.r?.eliminada === true && (await fotosEnBase(idA)) === 4, JSON.stringify(x));
x = await reg(OPER, idA, 'nueva.jpg');
ok('la foto nueva reutiliza el cupo 1', x.r?.nn === 1 && x.r.foto_id === f1.foto_id && x.r.ruta !== f1.ruta, JSON.stringify(x));
x = await api(OPER, 'api_m01_eliminar_foto', 'FOT-NO-EXISTE');
ok('eliminar una foto que no existe da E_NO_ENCONTRADO', err(x, 'E_NO_ENCONTRADO'), x.e);

console.log('\nIntentos que nunca se confirmaron');
await db.exec(`update m01_recepcion.fotos_meta set subido_en = now() - interval '2 hours' where recepcion_id='${idA}' and not confirmada`);
x = await reg(OPER, idA, 'otra.jpg');
ok('los intentos vencidos (más de 1 hora) se liberan al registrar', x.r && (await fotosEnBase(idA)) === 1, JSON.stringify(x));
ok('el único registro que queda es el nuevo', (await db.query(`select count(*)::int n from m01_recepcion.fotos_meta where recepcion_id=$1 and not confirmada`, [idA])).rows[0].n === 1);

console.log('\nEliminada y enlaces');
const C = await crear(OPER, 'F-3', { lote_id: '333-444-555' }); const idC = C.recepcion_id;
x = await reg(OPER, idC); const fC = x.r;
await subir(OPER, fC.ruta); await api(OPER, 'api_m01_confirmar_foto', fC.foto_id);
const vc = await api(ADMIN, 'api_m01_obtener_recepcion', idC);
await api(ADMIN, 'api_m01_eliminar', idC, 'prueba de eliminación', vc.r.version);
ok('la foto de una recepción eliminada no la ve un operativo', (await veo(OPER, fC.ruta)) === 0);
ok('el administrador sí la ve', (await veo(ADMIN, fC.ruta)) === 1);
x = await api(OPER, 'api_m01_fotos_recepcion', idC);
ok('el listado de fotos de una eliminada da E_NO_ENCONTRADO al operativo', err(x, 'E_NO_ENCONTRADO'), x.e);
x = await api(ADMIN, 'api_m01_obtener_recepcion', idA);
const ed = await api(OPER, 'api_m01_guardar_recepcion', nuevaR('F-1', { recepcion_id: idA, version: x.r.version, lote_id: '999-999-999' }));
ok('mover a otro lote una recepción con fotos da error', err(ed, 'E_VALIDACION'), ed.e);

console.log('\nAuditoría y permisos de las funciones');
const aud = (await db.query(`select accion, count(*)::int n from core.auditoria where accion in ('subir_foto','eliminar_foto') group by accion order by accion`)).rows;
ok('queda auditoría de subir y eliminar fotos', aud.find((a) => a.accion === 'subir_foto')?.n >= 2 && aud.find((a) => a.accion === 'eliminar_foto')?.n >= 1, JSON.stringify(aud));
x = await db.query(`select has_function_privilege('anon','public.api_m01_registrar_foto(text,text,text,integer)','execute') a, has_function_privilege('authenticated','public.api_m01_registrar_foto(text,text,text,integer)','execute') b, has_function_privilege('anon','public.m01_foto_permitida(text,text)','execute') c`);
ok('las funciones de fotos solo las ejecuta quien tiene sesión', x.rows[0].a === false && x.rows[0].b === true && x.rows[0].c === false);
await db.exec(`reset role;`);
const antes = (await db.query(`select count(*)::int n from storage.objects`)).rows[0].n;
await db.exec(`set role anon;`);
let anonOk = true; try { await db.query(`select * from storage.objects`); anonOk = false; } catch { /* sin permiso */ }
await db.exec(`reset role;`);
ok('un usuario sin sesión no puede leer el almacenamiento', anonOk && antes >= 0);

console.log(`\nRESULTADO: ${pass} correctas, ${fail} con fallo.`);
process.exit(fail ? 1 : 0);
