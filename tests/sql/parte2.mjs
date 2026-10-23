// Pruebas de la base de datos de la Parte 2 (tablas y reglas del módulo de Recepción).
// Aplica TODAS las migraciones de supabase/migrations (Partes 1 y 2) en una base PostgreSQL simulada (PGlite).
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(aqui, '../../supabase/migrations');
const db = new PGlite();

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
const OPER = '00000000-0000-0000-0000-000000000002';
await db.exec(`insert into auth.users(id,email) values ('${OPER}','op@x.com');`);

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, extra); } };
const falla = async (sql, patron) => { try { await db.query(sql); return false; } catch (e) { return patron ? patron.test(e.message) : true; } };
const como = async (uid, sql) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub','${uid}',false);`);
  try { return { r: await db.query(sql) }; } catch (e) { return { e: e.message }; } finally { await db.exec('reset role;'); }
};

console.log('\nMigraciones');
for (const f of fs.readdirSync(dir).sort()) {
  try { await db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); ok('se aplica ' + f, true); }
  catch (e) { ok('se aplica ' + f, false, e.message); process.exit(1); }
}

// Datos de apoyo
const prov = await db.query(`select core.obtener_o_crear_proveedor('Camaronera Árbol') as id`).then((r) => r.rows[0].id);
const esp = await db.query(`select core.obtener_o_crear_especie('Camarón') as id`).then((r) => r.rows[0].id);
await db.query(`insert into core.lotes(lote_id, proveedor_id, especie_id) values ('123-456-789', $1, $2)`, [prov, esp]);
await db.exec(`update core.perfiles set nombre='Operador' where user_id='${OPER}'`);

console.log('\nSeguridad: nadie toca las tablas directamente');
const tablas = (await db.query(`select n.nspname||'.'||c.relname as t, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname='m01_recepcion' order by 1`)).rows;
ok(`RLS activa en las ${tablas.length} tablas de m01_recepcion`, tablas.length === 6 && tablas.every((x) => x.rls), tablas.map((x) => x.t + ':' + x.rls).join(','));
let bloqueadas = 0;
for (const x of tablas) { const r = await como(OPER, `select * from ${x.t} limit 1`); if (r.e) bloqueadas++; }
ok('un usuario con sesión no puede leer ninguna tabla del módulo', bloqueadas === tablas.length, `${bloqueadas}/${tablas.length}`);
const w = await como(OPER, `insert into m01_recepcion.contadores values ('2026-01-01', 99)`);
ok('un usuario con sesión no puede escribir en las tablas del módulo', !!w.e);
await db.exec('set role anon;');
ok('el acceso anónimo no lee las tablas del módulo', await falla(`select * from m01_recepcion.recepciones`));
await db.exec('reset role;');
const f1 = await como(OPER, `select m01_recepcion.siguiente_id('2026-10-20')`);
ok('las funciones internas del módulo no se pueden llamar desde la API', !!f1.e);

console.log('\nIdentificador REC-AAAAMMDD-####');
const sid = async (f) => db.query(`select m01_recepcion.siguiente_id($1::date) as i`, [f]).then((r) => r.rows[0].i);
ok('primero del día', (await sid('2026-10-20')) === 'REC-20261020-0001');
ok('segundo del día', (await sid('2026-10-20')) === 'REC-20261020-0002');
ok('otro día reinicia en 0001', (await sid('2026-10-21')) === 'REC-20261021-0001');
const ids = await Promise.all([1, 2, 3, 4, 5].map(() => sid('2026-10-22')));
ok('5 pedidos seguidos dan 5 identificadores distintos', new Set(ids).size === 5, ids.join());

console.log('\nRecepciones: valores calculados y restricciones');
let n = 0;
const rec = async (extra = {}) => {
  n++;
  const v = { recepcion_id: `REC-20260101-${String(n).padStart(4, '0')}`, client_uuid: crypto.randomUUID(), fecha_llegada: '2026-10-20', lote_id: '123-456-789', proveedor_id: prov, especie_id: esp,
    guia_remision: `G-${n}`, num_gavetas_bines: 3, libras_reportadas: 1000, libras_planta: 990, hora_inicio_descarga: '08:00', hora_fin_descarga: '09:30', ...extra };
  const cols = Object.keys(v);
  await db.query(`insert into m01_recepcion.recepciones (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(v));
  return v.recepcion_id;
};
const id1 = await rec();
let t = await db.query(`select diferencia_lb, diferencia_pct, duracion_descarga_min, estado, version from m01_recepcion.recepciones where recepcion_id=$1`, [id1]);
ok('diferencia = -10 lb', Number(t.rows[0].diferencia_lb) === -10);
ok('diferencia = -1 %', Number(t.rows[0].diferencia_pct) === -1);
ok('duración = 90 minutos', t.rows[0].duracion_descarga_min === 90);
ok('nace como borrador, versión 1', t.rows[0].estado === 'borrador' && t.rows[0].version === 1);
await db.query(`update m01_recepcion.recepciones set libras_planta=1100 where recepcion_id='${id1}'`);
t = await db.query(`select diferencia_lb, diferencia_pct from m01_recepcion.recepciones where recepcion_id='${id1}'`);
ok('los calculados se actualizan al cambiar las libras (+100 lb, +10 %)', Number(t.rows[0].diferencia_lb) === 100 && Number(t.rows[0].diferencia_pct) === 10);
await db.query(`update m01_recepcion.recepciones set libras_planta=990 where recepcion_id='${id1}'`);
const id2 = await rec({ libras_reportadas: null, hora_fin_descarga: null });
t = await db.query(`select diferencia_lb, diferencia_pct, duracion_descarga_min from m01_recepcion.recepciones where recepcion_id=$1`, [id2]);
ok('sin libras reportadas ni hora final, los calculados quedan vacíos', t.rows[0].diferencia_lb === null && t.rows[0].diferencia_pct === null && t.rows[0].duracion_descarga_min === null);
const base = `insert into m01_recepcion.recepciones(recepcion_id,client_uuid,fecha_llegada,lote_id,proveedor_id,especie_id,guia_remision,num_gavetas_bines) values`;
ok('formato de identificador inválido rechazado', await falla(`${base} ('REC-T-1',gen_random_uuid(),'2026-10-20','123-456-789','${prov}','${esp}','GX1',1)`, /id_chk/));
ok('identificador con fecha incompleta rechazado', await falla(`${base} ('REC-2026-0001',gen_random_uuid(),'2026-10-20','123-456-789','${prov}','${esp}','GX2',1)`, /id_chk/));
ok('guía de remisión repetida rechazada', await falla(`${base} ('REC-20260102-0001',gen_random_uuid(),'2026-10-20','123-456-789','${prov}','${esp}','G-1',1)`, /recepciones_guia_key/));
ok('identificador de cliente repetido rechazado', await falla(`insert into m01_recepcion.recepciones(recepcion_id,client_uuid,fecha_llegada,lote_id,proveedor_id,especie_id,guia_remision,num_gavetas_bines) select 'REC-20260102-0002',client_uuid,'2026-10-20','123-456-789','${prov}','${esp}','G-Z',1 from m01_recepcion.recepciones limit 1`, /client_uuid_key/));
ok('estado inválido rechazado', await falla(`update m01_recepcion.recepciones set estado='otro' where recepcion_id='${id1}'`, /estado_chk/));
ok('0 gavetas rechazado', await falla(`update m01_recepcion.recepciones set num_gavetas_bines=0 where recepcion_id='${id1}'`, /gavetas_chk/));
ok('libras planta negativas rechazadas', await falla(`update m01_recepcion.recepciones set libras_planta=-1 where recepcion_id='${id1}'`, /lbs_pla_chk/));
ok('libras reportadas en cero rechazadas', await falla(`update m01_recepcion.recepciones set libras_reportadas=0 where recepcion_id='${id1}'`, /lbs_rep_chk/));
ok('hora final anterior a la inicial rechazada', await falla(`update m01_recepcion.recepciones set hora_fin_descarga='07:00' where recepcion_id='${id1}'`, /horas_chk/));
ok('observación de más de 2000 caracteres rechazada', await falla(`update m01_recepcion.recepciones set observacion=repeat('x',2001) where recepcion_id='${id1}'`, /obs_chk/));
ok('lote inexistente rechazado', await falla(`update m01_recepcion.recepciones set lote_id='999-999-999' where recepcion_id='${id1}'`, /foreign key/));
ok('proveedor inexistente rechazado', await falla(`update m01_recepcion.recepciones set proveedor_id=gen_random_uuid() where recepcion_id='${id1}'`, /foreign key/));
ok('especie inexistente rechazada', await falla(`update m01_recepcion.recepciones set especie_id=gen_random_uuid() where recepcion_id='${id1}'`, /foreign key/));
ok('«realizado por» debe ser un usuario existente', await falla(`update m01_recepcion.recepciones set realizado_por=gen_random_uuid() where recepcion_id='${id1}'`, /foreign key/));
ok('«realizado por» con un usuario real se acepta', !(await falla(`update m01_recepcion.recepciones set realizado_por='${OPER}' where recepcion_id='${id1}'`)));

console.log('\nEstados y anulación');
for (const x of ['cerrado', 'eliminado', 'borrador']) ok(`estado permitido: ${x}`, !(await falla(`update m01_recepcion.recepciones set estado='${x}' where recepcion_id='${id1}'`)));
ok('anular sin motivo rechazado', await falla(`update m01_recepcion.recepciones set estado='anulado' where recepcion_id='${id1}'`, /motivo_chk/));
ok('anular con motivo de 4 caracteres rechazado', await falla(`update m01_recepcion.recepciones set estado='anulado', motivo_anulacion='abcd' where recepcion_id='${id1}'`, /motivo_chk/));
ok('anular con motivo de espacios rechazado', await falla(`update m01_recepcion.recepciones set estado='anulado', motivo_anulacion='      ' where recepcion_id='${id1}'`, /motivo_chk/));
ok('anular con motivo válido aceptado', !(await falla(`update m01_recepcion.recepciones set estado='anulado', motivo_anulacion='Error de digitación' where recepcion_id='${id1}'`)));
ok('eliminar una anulada conserva el motivo', !(await falla(`update m01_recepcion.recepciones set estado='eliminado' where recepcion_id='${id1}'`)));
await db.query(`update m01_recepcion.recepciones set estado='borrador', motivo_anulacion=null where recepcion_id='${id1}'`);

console.log('\nProtecciones: datos inmutables y sin borrado');
ok('no se puede cambiar el identificador', await falla(`update m01_recepcion.recepciones set recepcion_id='REC-20260101-9999' where recepcion_id='${id1}'`, /no se pueden cambiar/));
ok('no se puede cambiar el identificador de cliente', await falla(`update m01_recepcion.recepciones set client_uuid=gen_random_uuid() where recepcion_id='${id1}'`, /no se pueden cambiar/));
ok('no se puede cambiar la fecha de creación', await falla(`update m01_recepcion.recepciones set creado_en=now()-interval '1 day' where recepcion_id='${id1}'`, /no se pueden cambiar/));
ok('no se puede cambiar quién creó la recepción', await falla(`update m01_recepcion.recepciones set creado_por='${OPER}' where recepcion_id='${id1}'`, /no se pueden cambiar/));
ok('el resto de los datos sí se puede editar', !(await falla(`update m01_recepcion.recepciones set piscina='P7', version=version+1 where recepcion_id='${id1}'`)));
ok('una recepción NO se puede borrar', await falla(`delete from m01_recepcion.recepciones where recepcion_id='${id1}'`, /no se borran/));
t = await db.query(`select count(*)::int c from m01_recepcion.recepciones where recepcion_id='${id1}'`);
ok('y sigue existiendo', t.rows[0].c === 1);

console.log('\nGavetas, temperaturas y almacenamiento');
ok('gaveta 1 con 40 lb', !(await falla(`insert into m01_recepcion.recepcion_gavetas values ('${id1}',1,40)`)));
ok('gaveta 30 permitida', !(await falla(`insert into m01_recepcion.recepcion_gavetas values ('${id1}',30,40)`)));
ok('gaveta 31 rechazada', await falla(`insert into m01_recepcion.recepcion_gavetas values ('${id1}',31,40)`, /check/));
ok('gaveta 0 rechazada', await falla(`insert into m01_recepcion.recepcion_gavetas values ('${id1}',0,40)`, /check/));
ok('gaveta repetida rechazada', await falla(`insert into m01_recepcion.recepcion_gavetas values ('${id1}',1,41)`, /duplicate key/));
ok('peso de gaveta en cero rechazado', await falla(`insert into m01_recepcion.recepcion_gavetas values ('${id1}',2,0)`, /check/));
ok('peso de gaveta negativo rechazado', await falla(`insert into m01_recepcion.recepcion_gavetas values ('${id1}',2,-5)`, /check/));
ok('gaveta de una recepción inexistente rechazada', await falla(`insert into m01_recepcion.recepcion_gavetas values ('REC-20269999-0001',1,40)`, /foreign key/));
ok('temperatura negativa permitida', !(await falla(`insert into m01_recepcion.recepcion_temperaturas values ('${id1}',1,'1,2',-1.5)`)));
ok('temperatura con un decimal se guarda tal cual', (await db.query(`select temperatura_c from m01_recepcion.recepcion_temperaturas where recepcion_id='${id1}' and lectura_id=1`)).rows[0].temperatura_c === '-1.5' || Number((await db.query(`select temperatura_c from m01_recepcion.recepcion_temperaturas where recepcion_id='${id1}' and lectura_id=1`)).rows[0].temperatura_c) === -1.5);
ok('lectura 7 rechazada', await falla(`insert into m01_recepcion.recepcion_temperaturas values ('${id1}',7,'1',-1)`, /check/));
ok('lectura 0 rechazada', await falla(`insert into m01_recepcion.recepcion_temperaturas values ('${id1}',0,'1',-1)`, /check/));
ok('lectura repetida rechazada', await falla(`insert into m01_recepcion.recepcion_temperaturas values ('${id1}',1,'3',2)`, /duplicate key/));
ok('almacenamiento válido', !(await falla(`insert into m01_recepcion.recepcion_almacenamiento values ('${id1}','1','A1','B1',-1,500)`)));
ok('bin repetido rechazado', await falla(`insert into m01_recepcion.recepcion_almacenamiento values ('${id1}','1','A9','B9',-1,500)`, /duplicate key/));
ok('sello de recepción repetido en la misma recepción rechazado', await falla(`insert into m01_recepcion.recepcion_almacenamiento values ('${id1}','2','A1','B2',-1,500)`, /sello_rec/));
ok('sello de almacenamiento repetido en la misma recepción rechazado', await falla(`insert into m01_recepcion.recepcion_almacenamiento values ('${id1}','2','A2','B1',-1,500)`, /sello_alm/));
ok('el mismo sello en OTRA recepción sí se permite', !(await falla(`insert into m01_recepcion.recepcion_almacenamiento values ('${id2}','1','A1','B1',-1,500)`)));
ok('varios bines sin sellos se permiten (sellos vacíos)', !(await falla(`insert into m01_recepcion.recepcion_almacenamiento(recepcion_id,num_bin) values ('${id1}','3'),('${id1}','4')`)));
ok('bin vacío rechazado', await falla(`insert into m01_recepcion.recepcion_almacenamiento(recepcion_id,num_bin) values ('${id1}','  ')`, /check/));
ok('libras aproximadas en cero rechazadas', await falla(`insert into m01_recepcion.recepcion_almacenamiento(recepcion_id,num_bin,libras_aprox) values ('${id1}','5',0)`, /check/));

console.log('\nFotos');
const ins = (id, nn, mime = 'image/jpeg', tam = 1000, ruta = 'ruta-' + id) => db.query(
  `insert into m01_recepcion.fotos_meta(foto_id,recepcion_id,lote_id,nn,ruta,nombre,tipo_mime,tamano_bytes) values ($1,'${id1}','123-456-789',$2,$3,'f',$4,$5)`,
  [id, nn, ruta, mime, tam]);
for (let i = 1; i <= 5; i++) await ins('F' + i, i);
ok('caben 5 fotos', (await db.query(`select count(*)::int c from m01_recepcion.fotos_meta where recepcion_id='${id1}'`)).rows[0].c === 5);
ok('la sexta foto se rechaza (E_FOTOS)', await ins('F6', 5).then(() => false).catch((er) => /E_FOTOS/.test(er.message)));
await db.query(`delete from m01_recepcion.fotos_meta where foto_id='F5'`);
ok('al borrar una foto se libera el cupo', await ins('F5b', 5).then(() => true).catch(() => false));
await db.query(`delete from m01_recepcion.fotos_meta where foto_id='F5b'`);
ok('número de foto 6 rechazado', await ins('FN6', 6).then(() => false).catch((er) => /check/.test(er.message)));
ok('número de foto 0 rechazado', await ins('FN0', 0).then(() => false).catch((er) => /check/.test(er.message)));
ok('número de foto repetido en la misma recepción rechazado', await ins('FR', 1).then(() => false).catch((er) => /duplicate|nn_key/.test(er.message)));
ok('formato PDF rechazado', await ins('FP', 5, 'application/pdf').then(() => false).catch((er) => /check/.test(er.message)));
ok('formato PNG aceptado', await ins('FPNG', 5, 'image/png').then(() => true).catch(() => false));
await db.query(`delete from m01_recepcion.fotos_meta where foto_id='FPNG'`);
ok('foto de más de 5 MB rechazada', await ins('FG', 5, 'image/jpeg', 5242881).then(() => false).catch((er) => /check/.test(er.message)));
ok('foto de exactamente 5 MB aceptada', await ins('FG5', 5, 'image/jpeg', 5242880).then(() => true).catch(() => false));
await db.query(`delete from m01_recepcion.fotos_meta where foto_id='FG5'`);
ok('foto de 0 bytes rechazada', await ins('F0B', 5, 'image/jpeg', 0).then(() => false).catch((er) => /check/.test(er.message)));
ok('la ruta de una foto es única', await ins('FZ', 5, 'image/jpeg', 10, 'ruta-F1').then(() => false).catch((er) => /duplicate|ruta_key/.test(er.message)));
ok('foto de una recepción inexistente rechazada', await falla(`insert into m01_recepcion.fotos_meta(foto_id,recepcion_id,lote_id,nn,ruta,nombre,tipo_mime,tamano_bytes) values ('FX','REC-20269999-0001','123-456-789',1,'rx','f','image/jpeg',10)`, /foreign key/));
t = await db.query(`select confirmada, drive_file_id, purgada_supabase_en from m01_recepcion.fotos_meta where foto_id='F1'`);
ok('una foto nueva nace sin confirmar y sin respaldo', t.rows[0].confirmada === false && t.rows[0].drive_file_id === null && t.rows[0].purgada_supabase_en === null);

console.log('\nBorrado excepcional (solo administración de la base de datos)');
await db.exec(`begin; set local prodmazul.permitir_borrado = 'si'; delete from m01_recepcion.recepciones where recepcion_id='${id1}'; commit;`);
t = await db.query(`select (select count(*) from m01_recepcion.recepciones where recepcion_id='${id1}')::int r,
  (select count(*) from m01_recepcion.recepcion_gavetas where recepcion_id='${id1}')::int g,
  (select count(*) from m01_recepcion.recepcion_temperaturas where recepcion_id='${id1}')::int t,
  (select count(*) from m01_recepcion.recepcion_almacenamiento where recepcion_id='${id1}')::int a,
  (select count(*) from m01_recepcion.fotos_meta where recepcion_id='${id1}')::int f`);
ok('con el permiso explícito se puede borrar y se borran sus detalles y fotos', Object.values(t.rows[0]).every((x) => x === 0), JSON.stringify(t.rows[0]));
ok('el permiso explícito no queda activo en la sesión', await falla(`delete from m01_recepcion.recepciones where recepcion_id='${id2}'`, /no se borran/));

console.log(`\nResultado: ${pass} correctas, ${fail} con fallo`);
process.exit(fail ? 1 : 0);
