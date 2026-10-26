// Pruebas de la base de datos de la Parte 1 (núcleo de seguridad, roles, auditoría y API base).
// Se ejecutan en una base PostgreSQL simulada (PGlite) con un Supabase mínimo simulado.
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
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true),'')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  grant usage on schema public to anon, authenticated;
`);
const ADMIN = '00000000-0000-0000-0000-000000000001', OPER = '00000000-0000-0000-0000-000000000002',
      CONS = '00000000-0000-0000-0000-000000000003', SIN = '00000000-0000-0000-0000-000000000004',
      OFF = '00000000-0000-0000-0000-000000000005', ADMMOD = '00000000-0000-0000-0000-000000000006';
// El administrador ya existía antes de aplicar las migraciones
await db.exec(`insert into auth.users(id,email) values ('${ADMIN}','admin@x.com');`);

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, extra); } };
const falla = async (sql, patron) => { try { await db.query(sql); return false; } catch (e) { return patron ? patron.test(e.message) : true; } };
const como = async (uid, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub','${uid}',false);`);
  try { return { r: await db.query(sql, params) }; } catch (e) { return { e: e.message }; } finally { await db.exec('reset role;'); }
};
const comoSuper = async (uid, sql) => { await db.exec(`select set_config('request.jwt.sub','${uid}',false);`); return db.query(sql); };

console.log('\nMigraciones');
for (const f of fs.readdirSync(dir).sort()) {
  try { await db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); ok('se aplica ' + f, true); }
  catch (e) { ok('se aplica ' + f, false, e.message); process.exit(1); }
}

await db.exec(`
  insert into auth.users(id,email) values ('${OPER}','op@x.com'),('${CONS}','co@x.com'),('${SIN}','sin@x.com'),('${OFF}','off@x.com'),('${ADMMOD}','am@x.com');
  update core.perfiles set es_admin_general = true, nombre = 'Admin' where user_id = '${ADMIN}';
  update core.perfiles set nombre = 'Operador Uno' where user_id = '${OPER}';
  update core.perfiles set activo = false where user_id = '${OFF}';
  insert into core.usuario_modulo_rol values ('${OPER}','M01','operativo'),('${CONS}','M01','consulta'),('${OFF}','M01','operativo'),('${ADMMOD}','M01','admin_modulo');
`);

console.log('\nPerfiles automáticos');
let t = await db.query(`select count(*)::int c from core.perfiles`);
ok('hay un perfil por cada usuario de Auth (incluido el que existía antes)', t.rows[0].c === 6, t.rows[0].c);
t = await db.query(`select correo, es_admin_general, activo from core.perfiles where user_id='${SIN}'`);
ok('un usuario nuevo nace activo, sin permisos de administrador', t.rows[0].correo === 'sin@x.com' && !t.rows[0].es_admin_general && t.rows[0].activo);

console.log('\nSeguridad: nadie toca las tablas directamente');
const tablas = (await db.query(`select n.nspname||'.'||c.relname as t, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('core') order by 1`)).rows;
ok(`RLS activa en las ${tablas.length} tablas del esquema core`, tablas.length === 14 && tablas.every((x) => x.rls), tablas.filter((x) => !x.rls).map((x) => x.t).join(','));
let bloqueadas = 0;
for (const x of tablas) { const r = await como(OPER, `select * from ${x.t} limit 1`); if (r.e) bloqueadas++; }
ok('un usuario con sesión no puede leer ninguna tabla', bloqueadas === tablas.length, `${bloqueadas}/${tablas.length}`);
const r2 = await como(OPER, `insert into core.perfiles(user_id,correo,es_admin_general) values (gen_random_uuid(),'x',true)`);
ok('un usuario con sesión no puede escribir ni autoascenderse', !!r2.e);
const r3 = await como(OPER, `update core.perfiles set es_admin_general = true where user_id = '${OPER}'`);
ok('un usuario no puede hacerse administrador general', !!r3.e);
await db.exec('set role anon;');
ok('el acceso anónimo no ejecuta api_mi_perfil', await falla(`select public.api_mi_perfil()`, /permission denied/));
ok('el acceso anónimo no ejecuta api_config_publica', await falla(`select public.api_config_publica()`, /permission denied/));
ok('el acceso anónimo no lee tablas', await falla(`select * from core.config`));
await db.exec('reset role;');
t = await como(OPER, `select core.tiene_permiso('M01','ver')`);
ok('las funciones internas de core no se pueden llamar desde la API', !!t.e);

console.log('\nPermisos por rol (api_mi_perfil)');
const perfil = async (uid) => (await como(uid, 'select public.api_mi_perfil() as r')).r.rows[0].r;
let p = await perfil(OPER);
ok('operativo: ve M01 con 6 permisos', p.modulos.length === 1 && p.modulos[0].permisos.join() === 'anular,cargar_imagenes,crear,editar,ver,ver_reportes', p.modulos[0]?.permisos.join());
ok('operativo: no puede eliminar', !p.modulos[0].permisos.includes('eliminar'));
ok('operativo: trae su nombre', p.nombre === 'Operador Uno');
p = await perfil(CONS);
ok('consulta: solo ver y ver_reportes', p.modulos[0].permisos.join() === 'ver,ver_reportes');
p = await perfil(ADMMOD);
ok('administrador de módulo: 8 permisos', p.modulos[0].permisos.length === 8 && p.modulos[0].permisos.includes('eliminar') && p.modulos[0].permisos.includes('admin_config'));
p = await perfil(ADMIN);
ok('administrador general: todos los permisos y marcado como tal', p.es_admin_general === true && p.modulos[0].permisos.length === 8 && p.modulos[0].rol_id === 'admin_general');
p = await perfil(SIN);
ok('usuario sin rol: ningún módulo (los módulos no autorizados se ocultan)', p.activo === true && p.modulos.length === 0);
p = await perfil(OFF);
ok('usuario desactivado: activo = false y sin módulos', p.activo === false && !p.modulos);
p = await perfil('99999999-9999-9999-9999-999999999999');
ok('usuario inexistente: activo = false', p.activo === false);

console.log('\nPermisos (función interna, probada como superusuario)');
const tp = async (uid, perm, mod = 'M01') => (await comoSuper(uid, `select core.tiene_permiso('${mod}','${perm}') as v`)).rows[0].v;
ok('operativo puede crear', await tp(OPER, 'crear'));
ok('operativo no puede eliminar', !(await tp(OPER, 'eliminar')));
ok('consulta no puede crear', !(await tp(CONS, 'crear')));
ok('desactivado no puede nada', !(await tp(OFF, 'ver')));
ok('sin rol no puede nada', !(await tp(SIN, 'ver')));
ok('admin general puede todo', (await tp(ADMIN, 'eliminar')) && (await tp(ADMIN, 'admin_config')));
ok('un módulo inexistente no da permisos ni al admin general', !(await tp(ADMIN, 'ver', 'M99')));
await db.exec(`update core.modulos set habilitado=false where modulo_id='M01'`);
ok('un módulo deshabilitado no da permisos', !(await tp(OPER, 'ver')) && !(await tp(ADMIN, 'ver')));
p = await perfil(OPER);
ok('un módulo deshabilitado desaparece del menú', p.modulos.length === 0);
await db.exec(`update core.modulos set habilitado=true where modulo_id='M01'`);
await db.exec(`select set_config('request.jwt.sub','${OPER}',false)`);
t = await db.query(`select core.exigir('M01','eliminar')`).then(() => 'sin error').catch((x) => x.message);
ok('exigir() rechaza con el código E_PERMISO', /E_PERMISO\|/.test(t), t);

console.log('\nConfiguración pública');
const c = (await como(OPER, 'select public.api_config_publica() as r')).r.rows[0].r;
ok('devuelve factor, formato de lote, máximo de fotos y datos del formulario', c.factor_lb_kg === 2.20462 && c.max_fotos_recepcion === 5 && c.formulario_m01.codigo === 'PROM-M-P-P5-F1-C' && typeof c.formato_lote === 'string');
ok('no expone parámetros internos (retención de fotos)', c.dias_retencion_fotos === undefined);
t = await como(OFF, 'select public.api_config_publica()');
ok('un usuario desactivado no recibe la configuración', /E_PERMISO/.test(t.e || ''), t.e);

console.log('\nDatos base');
t = await db.query(`select count(*)::int c from core.roles`); ok('3 roles', t.rows[0].c === 3);
t = await db.query(`select count(*)::int c from core.permisos`); ok('8 permisos', t.rows[0].c === 8);
t = await db.query(`select rol_id, count(*)::int c from core.rol_permisos group by 1 order by 1`);
ok('matriz de permisos: admin_modulo 8, consulta 2, operativo 6', t.rows.map((x) => `${x.rol_id}:${x.c}`).join() === 'admin_modulo:8,consulta:2,operativo:6', JSON.stringify(t.rows));
t = await db.query(`select valor #>> '{}' as v from core.config where clave='dias_retencion_fotos'`); ok('retención de fotos: 60 días', t.rows[0].v === '60');

console.log('\nNormalización y formato de lote');
t = await db.query(`select core.normalizar('  Camaronera   Árbol  ñandú ') as n`);
ok('normaliza tildes, espacios y mayúsculas', t.rows[0].n === 'CAMARONERA ARBOL NANDU', t.rows[0].n);
const lote = async (x) => db.query(`select core.validar_lote($1) as l`, [x]).then((r) => r.rows[0].l).catch((er) => 'ERR:' + er.message);
for (const v of ['123-456-789', '123-456A-789', '123A-456B-789C', 'A123-456-789']) ok(`lote válido: ${v}`, (await lote(v)) === v.toUpperCase());
ok('lote en minúsculas se guarda en mayúsculas', (await lote('123-456a-789')) === '123-456A-789');
ok('lote con espacios alrededor se recorta', (await lote('  123-456-789 ')) === '123-456-789');
for (const v of ['12-34', '1234-456-789', '123-456', '123-456-789-000', '123-45A6-789', '123-456AB-789', '123456789', 'ABC-DEF-GHI', '']) ok(`lote inválido: «${v}»`, (await lote(v)).startsWith('ERR:E_VALIDACION'), await lote(v));

console.log('\nProveedores y especies sin catálogo inicial');
const prov = (n) => db.query(`select core.obtener_o_crear_proveedor($1) as id`, [n]).then((r) => r.rows[0].id);
const a = await prov('Camaronera  Árbol'), b = await prov('camaronera arbol'), d = await prov('Otra Camaronera');
ok('el mismo nombre con otra escritura no se duplica', a === b && a !== d);
t = await db.query(`select nombre from core.proveedores where id='${a}'`);
ok('se conserva el nombre como se escribió la primera vez (sin espacios dobles)', t.rows[0].nombre === 'Camaronera Árbol', t.rows[0].nombre);
ok('un proveedor vacío se rechaza', /E_VALIDACION/.test(await prov('   ').catch((er) => er.message)));
const esp = await db.query(`select core.obtener_o_crear_especie('Camarón') as id`).then((r) => r.rows[0].id);
const esp2 = await db.query(`select core.obtener_o_crear_especie('CAMARON') as id`).then((r) => r.rows[0].id);
ok('la especie tampoco se duplica por tildes o mayúsculas', esp === esp2);
await db.query(`insert into core.lotes(lote_id, proveedor_id, especie_id) values ('123-456-789', $1, $2)`, [a, esp]);
ok('no existen lotes repetidos', await falla(`insert into core.lotes(lote_id, proveedor_id) values ('123-456-789', '${a}')`, /duplicate key/));

console.log('\nAuditoría');
await comoSuper(OPER, `select core.auditar('M01','prueba','recepcion','REC-T-1','{"a":1}'::jsonb)`);
t = await db.query(`select user_id, modulo_id, accion, detalle from core.auditoria order by evento_id desc limit 1`);
ok('registra usuario, módulo, acción y detalle', t.rows[0].user_id === OPER && t.rows[0].modulo_id === 'M01' && t.rows[0].accion === 'prueba' && t.rows[0].detalle.a === 1);
ok('la auditoría NO se puede modificar', await falla(`update core.auditoria set accion='x'`, /no se puede modificar/));
ok('la auditoría NO se puede borrar', await falla(`delete from core.auditoria`, /no se puede modificar/));
t = await como(OPER, `select * from core.auditoria`);
ok('un usuario no puede leer la auditoría', !!t.e);

console.log(`\nResultado: ${pass} correctas, ${fail} con fallo`);
process.exit(fail ? 1 : 0);
