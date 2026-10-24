// Pruebas de la Parte 4: guardar y consultar recepciones (API de la base de datos).
// Aplica TODAS las migraciones (Partes 1, 2 y 4) en una base PostgreSQL simulada (PGlite).
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
const SIN = '00000000-0000-0000-0000-000000000005';

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
const err = (x, codigo) => !!x.e && x.e.startsWith(codigo + '|');

console.log('\nMigraciones');
for (const f of fs.readdirSync(dir).sort()) {
  try { await db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); ok('se aplica ' + f, true); }
  catch (e) { ok('se aplica ' + f, false, e.message); process.exit(1); }
}
await db.exec(`
  insert into auth.users(id,email) values ('${ADMIN}','admin@x.com'),('${OPER}','op@x.com'),('${OPER2}','op2@x.com'),('${CONS}','co@x.com'),('${SIN}','sin@x.com');
  update core.perfiles set es_admin_general = true, nombre = 'Admin' where user_id = '${ADMIN}';
  update core.perfiles set nombre = 'Operador Uno' where user_id = '${OPER}';
  update core.perfiles set nombre = 'Operador Dos' where user_id = '${OPER2}';
  insert into core.usuario_modulo_rol values ('${OPER}','M01','operativo'),('${OPER2}','M01','operativo'),('${CONS}','M01','consulta');
`);

const hoy = (await db.query(`select (now() at time zone 'America/Guayaquil')::date as d`)).rows[0].d.toISOString().slice(0, 10);
const manana = new Date(Date.parse(hoy) + 86400000).toISOString().slice(0, 10);
const base = (extra = {}) => ({
  client_uuid: crypto.randomUUID(), estado: 'cerrado', fecha_llegada: hoy, placa_vehiculo: 'ABC-1234',
  lote_id: '123-456-789', proveedor: 'Camaronera Árbol', especie: 'Camarón', piscina: 'P-7',
  guia_remision: 'G-' + Math.random().toString(36).slice(2, 9), num_gavetas_bines: 3,
  libras_reportadas: 1000, libras_planta: 990, hora_inicio_descarga: '08:00', hora_fin_descarga: '09:30',
  observacion: 'Sin novedad',
  gavetas: [{ num_gaveta: 1, peso_lb: 100 }, { num_gaveta: 2, peso_lb: 110 }, { num_gaveta: 3, peso_lb: 120 }],
  temperaturas: [{ lectura_id: 1, bines: 'B1', temperatura_c: 2.5 }],
  almacenamiento: [{ num_bin: 'B1', sellos_recepcion: 'S1', sellos_almacenamiento: 'A1', temperatura_c: 2.5, libras_aprox: 500 },
                   { num_bin: 'B2', sellos_recepcion: 'S2', sellos_almacenamiento: 'A2', temperatura_c: 3, libras_aprox: 490 }],
  ...extra,
});

console.log('\nSeguridad de las funciones');
const pri = await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as aut
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
  ('api_listar_catalogo','api_obtener_lote','api_m01_guardar_recepcion','api_m01_obtener_recepcion','api_m01_listar_recepciones')`);
ok('existen las 5 funciones nuevas', pri.rows.length === 5);
ok('solo los usuarios con sesión pueden ejecutarlas (anon no)', pri.rows.every((x) => x.aut && !x.anon));
ok('un usuario sin rol en el módulo no puede guardar', err(await api(SIN, 'api_m01_guardar_recepcion', base()), 'E_PERMISO'));
ok('un usuario sin rol en el módulo no puede listar', err(await api(SIN, 'api_m01_listar_recepciones', {}), 'E_PERMISO'));
ok('un usuario sin rol no puede consultar el catálogo', err(await api(SIN, 'api_listar_catalogo', 'lotes', ''), 'E_PERMISO'));
ok('consulta (solo lectura) no puede crear', err(await api(CONS, 'api_m01_guardar_recepcion', base()), 'E_PERMISO'));

console.log('\nCrear una recepción');
const d1 = base({ guia_remision: 'G-0001' });
const r1 = await api(OPER, 'api_m01_guardar_recepcion', d1);
ok('el operativo crea y recibe el identificador', !!r1.r && /^REC-\d{8}-0001$/.test(r1.r.recepcion_id) && r1.r.version === 1 && r1.r.duplicado === false, JSON.stringify(r1));
const ID1 = r1.r?.recepcion_id;
const o1 = await api(OPER, 'api_m01_obtener_recepcion', ID1);
ok('se guarda con el estado, lote y guía indicados', o1.r?.estado === 'cerrado' && o1.r?.lote_id === '123-456-789' && o1.r?.guia_remision === 'G-0001');
ok('proveedor y especie se crean al escribirlos (en mayúsculas, sin tildes)', (await db.query(`select (select nombre_normalizado from core.proveedores) as p, (select nombre_normalizado from core.especies) as e`)).rows[0].p === 'CAMARONERA ARBOL');
ok('el nombre mostrado conserva lo escrito', o1.r?.proveedor_nombre === 'Camaronera Árbol' && o1.r?.especie_nombre === 'Camarón');
ok('peso promedio = promedio de las gavetas (110)', Number(o1.r?.peso_promedio_lb) === 110);
ok('diferencia -10 lb y -1 %', Number(o1.r?.diferencia_lb) === -10 && Number(o1.r?.diferencia_pct) === -1);
ok('duración de descarga 90 min', o1.r?.duracion_descarga_min === 90);
ok('gavetas, temperaturas y almacenamiento se guardan', o1.r?.gavetas.length === 3 && o1.r?.temperaturas.length === 1 && o1.r?.almacenamiento.length === 2);
ok('el realizado por es quien guardó', o1.r?.realizado_por_nombre === 'Operador Uno');
ok('queda registro en la auditoría', Number((await db.query(`select count(*) c from core.auditoria where accion='crear' and entidad_id='${ID1}'`)).rows[0].c) === 1);
const r2 = await api(OPER, 'api_m01_guardar_recepcion', base({ guia_remision: 'G-0002', estado: 'borrador', libras_planta: null, libras_reportadas: null, gavetas: [], temperaturas: [], almacenamiento: [] }));
ok('un borrador se puede guardar incompleto y numera 0002', /-0002$/.test(r2.r?.recepcion_id ?? '') && r2.r?.estado === 'borrador', JSON.stringify(r2));
const ID2 = r2.r?.recepcion_id;

console.log('\nLote existente: el proveedor se hereda');
const r3 = await api(OPER2, 'api_m01_guardar_recepcion', base({ guia_remision: 'G-0003', proveedor: 'Otro Nombre', especie: 'Camarón' }));
const o3 = await api(OPER2, 'api_m01_obtener_recepcion', r3.r?.recepcion_id);
ok('dos recepciones del mismo lote conservan el proveedor del lote', o3.r?.proveedor_nombre === 'Camaronera Árbol');
ok('no se creó el proveedor «Otro Nombre»', Number((await db.query(`select count(*) c from core.proveedores`)).rows[0].c) === 1);
ok('un lote nuevo sin proveedor se rechaza', err(await api(OPER, 'api_m01_guardar_recepcion', base({ lote_id: '111-222-333', proveedor: '', guia_remision: 'G-0004' })), 'E_VALIDACION'));
const r5 = await api(OPER, 'api_m01_guardar_recepcion', base({ lote_id: '111-222-333A', proveedor: 'Pesquera Sur', guia_remision: 'G-0005' }));
ok('un lote nuevo crea lote y proveedor', !!r5.r && Number((await db.query(`select count(*) c from core.lotes`)).rows[0].c) === 2);

console.log('\nValidaciones al guardar');
const v = async (n, extra, cod = 'E_VALIDACION') => ok(n, err(await api(OPER, 'api_m01_guardar_recepcion', base({ guia_remision: 'V-' + Math.random(), ...extra })), cod));
await v('fecha futura rechazada', { fecha_llegada: manana });
await v('fecha obligatoria', { fecha_llegada: '' });
await v('fecha con formato inválido', { fecha_llegada: 'ayer' });
await v('guía obligatoria', { guia_remision: '   ' });
await v('número de gavetas menor a 1', { num_gavetas_bines: 0 });
await v('formato de lote inválido', { lote_id: '12-34' });
await v('lote obligatorio', { lote_id: '' });
await v('especie obligatoria con lote nuevo', { lote_id: '222-333-444', proveedor: 'X', especie: '' });
await v('hora fin anterior a la de inicio', { hora_inicio_descarga: '10:00', hora_fin_descarga: '09:00' });
await v('peso de gaveta negativo', { gavetas: [{ num_gaveta: 1, peso_lb: -5 }] });
await v('peso de gaveta no numérico', { gavetas: [{ num_gaveta: 1, peso_lb: 'mucho' }] });
await v('estado no permitido', { estado: 'anulado' });
await v('cerrar sin libras de planta', { libras_planta: null });
await v('cerrar sin gavetas', { gavetas: [] });
await v('temperatura de un bin que no existe en almacenamiento', { temperaturas: [{ lectura_id: 1, bines: 'B9', temperatura_c: 2 }] });
await v('client_uuid inválido', { client_uuid: 'no-es-uuid' });
await v('gavetas con número repetido', { gavetas: [{ num_gaveta: 1, peso_lb: 10 }, { num_gaveta: 1, peso_lb: 11 }] }, 'E_DUPLICADO');
await v('sellos repetidos entre bines', { almacenamiento: [{ num_bin: 'B1', sellos_recepcion: 'X' }, { num_bin: 'B2', sellos_recepcion: 'X' }], temperaturas: [] }, 'E_DUPLICADO');
ok('la guía repetida se rechaza con E_DUPLICADO', err(await api(OPER, 'api_m01_guardar_recepcion', base({ guia_remision: 'G-0001' })), 'E_DUPLICADO'));
ok('lo rechazado no deja recepciones a medias', Number((await db.query(`select count(*) c from m01_recepcion.recepciones`)).rows[0].c) === 4);

console.log('\nReintentos (idempotencia)');
const rep = await api(OPER, 'api_m01_guardar_recepcion', d1);
ok('reenviar el mismo envío devuelve la misma recepción', rep.r?.recepcion_id === ID1 && rep.r?.duplicado === true, JSON.stringify(rep));
ok('no se duplicó', Number((await db.query(`select count(*) c from m01_recepcion.recepciones where client_uuid='${d1.client_uuid}'`)).rows[0].c) === 1);

console.log('\nEditar');
const edit = (o, extra = {}) => ({ ...base(), recepcion_id: o.recepcion_id, version: o.version, guia_remision: o.guia_remision, lote_id: o.lote_id, ...extra });
const e1 = await api(OPER, 'api_m01_guardar_recepcion', edit(o1.r, { libras_planta: 1010, observacion: 'Corregido' }));
ok('el creador edita y la versión sube a 2', e1.r?.version === 2 && e1.r?.duplicado === false, JSON.stringify(e1));
const oe = await api(OPER, 'api_m01_obtener_recepcion', ID1);
ok('los cambios quedan guardados (diferencia +10 lb)', Number(oe.r?.diferencia_lb) === 10 && oe.r?.observacion === 'Corregido' && oe.r?.version === 2);
ok('editar con una versión vieja da E_VERSION', err(await api(OPER, 'api_m01_guardar_recepcion', edit(o1.r)), 'E_VERSION'));
ok('otro operativo no puede editar lo ajeno', err(await api(OPER2, 'api_m01_guardar_recepcion', edit(oe.r)), 'E_PERMISO'));
const ea = await api(ADMIN, 'api_m01_guardar_recepcion', edit(oe.r, { observacion: 'Revisado por admin' }));
ok('el administrador general sí puede editar lo ajeno', ea.r?.version === 3, JSON.stringify(ea));
ok('consulta no puede editar', err(await api(CONS, 'api_m01_guardar_recepcion', edit({ ...oe.r, version: 3 })), 'E_PERMISO'));
ok('editar una recepción inexistente da E_NO_ENCONTRADO', err(await api(OPER, 'api_m01_guardar_recepcion', edit({ ...oe.r, recepcion_id: 'REC-20200101-0001' })), 'E_NO_ENCONTRADO'));
const ec = await api(OPER, 'api_m01_guardar_recepcion', edit({ ...oe.r, version: 3 }, { gavetas: [{ num_gaveta: 1, peso_lb: 50 }], temperaturas: [], almacenamiento: [] }));
const oc = await api(OPER, 'api_m01_obtener_recepcion', ID1);
ok('al editar se reemplazan gavetas y almacenamiento', oc.r?.gavetas.length === 1 && oc.r?.almacenamiento.length === 0 && Number(oc.r?.peso_promedio_lb) === 50, JSON.stringify(ec));
ok('un borrador puede cerrarse', (await api(OPER, 'api_m01_guardar_recepcion', edit({ ...(await api(OPER, 'api_m01_obtener_recepcion', ID2)).r }, { estado: 'cerrado' }))).r?.estado === 'cerrado');
await db.exec(`set local prodmazul.permitir_borrado='si'`).catch(() => {});
await db.exec(`update m01_recepcion.recepciones set estado='anulado', motivo_anulacion='prueba de anulación' where recepcion_id='${ID2}'`);
ok('una recepción anulada no se puede editar', err(await api(OPER, 'api_m01_guardar_recepcion', edit({ ...(await api(OPER, 'api_m01_obtener_recepcion', ID2)).r }, {})), 'E_ESTADO'));
await db.exec(`insert into m01_recepcion.fotos_meta(foto_id,recepcion_id,lote_id,nn,ruta,nombre,tipo_mime,tamano_bytes,confirmada) values ('F1','${ID1}','123-456-789',1,'ruta/f1','f1.jpg','image/jpeg',1000,true)`);
const oF = (await api(OPER, 'api_m01_obtener_recepcion', ID1)).r;
ok('con fotos no se puede cambiar el lote', err(await api(OPER, 'api_m01_guardar_recepcion', edit(oF, { lote_id: '111-222-333A' })), 'E_VALIDACION'));
ok('obtener incluye las fotos confirmadas', oF.fotos.length === 1);

console.log('\nConsultar');
ok('obtener una recepción inexistente da E_NO_ENCONTRADO', err(await api(OPER, 'api_m01_obtener_recepcion', 'REC-20200101-9999'), 'E_NO_ENCONTRADO'));
ok('consulta (solo lectura) puede obtener', !!(await api(CONS, 'api_m01_obtener_recepcion', ID1)).r);
const l0 = (await api(OPER, 'api_m01_listar_recepciones', {})).r;
ok('listado «activos» excluye anuladas (3 de 4)', l0.total === 3 && l0.items.length === 3, JSON.stringify(l0.total));
ok('listado ordenado por fecha y número descendente', l0.items.every((x, i, a) => i === 0 || a[i - 1].recepcion_id >= x.recepcion_id));
ok('cada ítem trae proveedor, especie y diferencia', !!l0.items[0].proveedor_nombre && 'diferencia_lb' in l0.items[0]);
ok('filtro «todos» incluye anuladas', (await api(OPER, 'api_m01_listar_recepciones', { estado: 'todos' })).r.total === 4);
ok('filtro «anulado»', (await api(OPER, 'api_m01_listar_recepciones', { estado: 'anulado' })).r.total === 1);
ok('búsqueda por guía', (await api(OPER, 'api_m01_listar_recepciones', { busqueda: 'g-0001' })).r.total === 1);
ok('búsqueda por proveedor sin tildes ni mayúsculas', (await api(OPER, 'api_m01_listar_recepciones', { busqueda: 'pesquera sur' })).r.total === 1);
ok('búsqueda por lote', (await api(OPER, 'api_m01_listar_recepciones', { busqueda: '111-222' })).r.total === 1);
ok('búsqueda por placa', (await api(OPER, 'api_m01_listar_recepciones', { busqueda: 'abc-1234' })).r.total === 3);
ok('búsqueda sin resultados', (await api(OPER, 'api_m01_listar_recepciones', { busqueda: 'zzzz' })).r.total === 0);
ok('filtro por fechas (futuro = 0)', (await api(OPER, 'api_m01_listar_recepciones', { desde: manana })).r.total === 0);
const pg = (await api(OPER, 'api_m01_listar_recepciones', { limite: 2, desplazamiento: 2 })).r;
ok('paginación: total 3, segunda página trae 1', pg.total === 3 && pg.items.length === 1);
ok('el límite máximo es 100', (await api(OPER, 'api_m01_listar_recepciones', { limite: 5000 })).r.items.length === 3);
ok('fecha de filtro inválida da E_VALIDACION', err(await api(OPER, 'api_m01_listar_recepciones', { desde: 'hola' }), 'E_VALIDACION'));
ok('estado de filtro inválido da E_VALIDACION', err(await api(OPER, 'api_m01_listar_recepciones', { estado: 'xx' }), 'E_VALIDACION'));
await db.exec(`update m01_recepcion.recepciones set estado='eliminado', eliminado_en=now() where recepcion_id='${ID2}'`);
ok('«todos» no muestra eliminadas a un operativo', (await api(OPER, 'api_m01_listar_recepciones', { estado: 'todos' })).r.total === 3);
ok('«todos» sí las muestra al administrador', (await api(ADMIN, 'api_m01_listar_recepciones', { estado: 'todos' })).r.total === 4);
ok('un operativo no puede pedir «eliminado»', err(await api(OPER, 'api_m01_listar_recepciones', { estado: 'eliminado' }), 'E_PERMISO'));
ok('una recepción eliminada no se puede obtener (operativo)', err(await api(OPER, 'api_m01_obtener_recepcion', ID2), 'E_NO_ENCONTRADO'));
ok('el administrador sí puede obtenerla', !!(await api(ADMIN, 'api_m01_obtener_recepcion', ID2)).r);

console.log('\nCatálogo y lote');
ok('catálogo de proveedores filtra por texto', (await api(OPER, 'api_listar_catalogo', 'proveedores', 'arbol')).r.length === 1);
ok('catálogo de especies', (await api(OPER, 'api_listar_catalogo', 'especies', '')).r.length === 1);
ok('catálogo de lotes trae proveedor', (await api(OPER, 'api_listar_catalogo', 'lotes', '123')).r[0].proveedor_nombre === 'Camaronera Árbol');
ok('tipo de catálogo inválido', err(await api(OPER, 'api_listar_catalogo', 'otros', ''), 'E_VALIDACION'));
ok('obtener lote existente', (await api(OPER, 'api_obtener_lote', '123-456-789')).r.existe === true);
ok('obtener lote nuevo → existe=false', (await api(OPER, 'api_obtener_lote', '999-999-999')).r.existe === false);
ok('obtener lote con formato inválido', err(await api(OPER, 'api_obtener_lote', 'abc'), 'E_VALIDACION'));
ok('el lote se acepta en minúsculas', (await api(OPER, 'api_obtener_lote', '123-456-789')).r.lote_id === '123-456-789' && (await api(OPER, 'api_obtener_lote', '111-222-333a')).r.existe === true);

console.log('\nConcurrencia');
const lote = base({ guia_remision: 'G-CONC' });
const par = await Promise.all([api(OPER, 'api_m01_guardar_recepcion', lote), api(OPER, 'api_m01_guardar_recepcion', lote)]);
ok('dos envíos simultáneos iguales dejan una sola recepción', Number((await db.query(`select count(*) c from m01_recepcion.recepciones where client_uuid='${lote.client_uuid}'`)).rows[0].c) === 1);

console.log(`\nRESULTADO: ${pass} correctas, ${fail} con fallo.`);
process.exit(fail ? 1 : 0);
