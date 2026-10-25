// Pruebas de la Parte 7: recepción completa (gavetas, temperaturas, almacenamiento) y datos de demostración.
// Aplica TODAS las migraciones (Partes 1, 2, 4, 5 y 6) en una base PostgreSQL simulada (PGlite).
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(aqui, '../../supabase/migrations');
const docs = path.resolve(aqui, '../../docs');
const db = new PGlite();
const ADMIN = '00000000-0000-0000-0000-000000000001';
const OPER = '00000000-0000-0000-0000-000000000002';
const OPER2 = '00000000-0000-0000-0000-000000000003';
const CONS = '00000000-0000-0000-0000-000000000004';

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true),''), nullif(current_setting('request.jwt.sub', true),''))::uuid $$;
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


const completa = (guia, extra = {}) => nueva(guia, {
  num_gavetas_bines: 3, gavetas: [{ num_gaveta: 1, peso_lb: 50 }, { num_gaveta: 5, peso_lb: 61.5 }, { num_gaveta: 30, peso_lb: 10 }],
  temperaturas: [{ lectura_id: 1, num_gaveta: 1, temperatura_c: -2.5 }, { lectura_id: 2, num_gaveta: 30, temperatura_c: 1.3 }],
  almacenamiento: [
    { num_bin: 'B1', sellos_recepcion: 'SR-1', sellos_almacenamiento: 'SA-1', temperatura_c: -3, libras_aprox: 300 },
    { num_bin: 'B2', sellos_recepcion: 'SR-2', sellos_almacenamiento: 'SA-2', temperatura_c: 1.5, libras_aprox: 200.5 }], ...extra });

console.log('\nRecepción completa');
const c1 = await api(OPER, 'api_m01_guardar_recepcion', completa('P7-A'));
ok('se guarda una recepción completa', !!c1.r?.recepcion_id, JSON.stringify(c1));
const v1 = await ver(c1.r.recepcion_id, OPER);
ok('al volver a abrirla trae las 3 gavetas con su número', v1.gavetas?.length === 3 && v1.gavetas.map((g) => g.num_gaveta).join() === '1,5,30', JSON.stringify(v1.gavetas));
ok('conserva decimales, negativos y la gaveta de cada temperatura', v1.temperaturas?.length === 2 && Number(v1.temperaturas[0].temperatura_c) === -2.5 && v1.temperaturas[0].num_gaveta === 1 && v1.temperaturas[1].num_gaveta === 30, JSON.stringify(v1.temperaturas));
ok('conserva el almacenamiento', v1.almacenamiento?.length === 2 && Number(v1.almacenamiento[1].libras_aprox) === 200.5 && Number(v1.almacenamiento[0].temperatura_c) === -3, JSON.stringify(v1.almacenamiento));

console.log('\nValidaciones de la base');
let z;
z = await api(OPER, 'api_m01_guardar_recepcion', completa('P7-B', { temperaturas: [{ lectura_id: 1, num_gaveta: 9, temperatura_c: 2 }] }));
ok('una temperatura de una gaveta sin peso se rechaza', err(z, 'E_VALIDACION'), JSON.stringify(z));
z = await api(OPER, 'api_m01_guardar_recepcion', completa('P7-B2', { temperaturas: [{ lectura_id: 1, num_gaveta: 1, temperatura_c: 2 }, { lectura_id: 2, num_gaveta: 1, temperatura_c: 3 }] }));
ok('dos temperaturas para la misma gaveta se rechazan', err(z, 'E_VALIDACION'), JSON.stringify(z));
z = await api(OPER, 'api_m01_guardar_recepcion', completa('P7-B3', { temperaturas: [{ lectura_id: 1, temperatura_c: 2 }] }));
ok('una temperatura sin gaveta se rechaza', err(z, 'E_VALIDACION'), JSON.stringify(z));
z = await api(OPER, 'api_m01_guardar_recepcion', completa('P7-C', { almacenamiento: [
  { num_bin: 'B1', sellos_recepcion: 'SR-1', libras_aprox: 10 }, { num_bin: 'B2', sellos_recepcion: 'SR-1', libras_aprox: 10 }] , temperaturas: [] }));
ok('un sello de recepción repetido se rechaza', !!z.e, JSON.stringify(z));
z = await api(OPER, 'api_m01_guardar_recepcion', completa('P7-D', { almacenamiento: [
  { num_bin: 'B1', libras_aprox: 10 }, { num_bin: 'B1', libras_aprox: 10 }], temperaturas: [] }));
ok('un bin repetido se rechaza', !!z.e, JSON.stringify(z));
z = await api(OPER, 'api_m01_guardar_recepcion', completa('P7-E', { gavetas: [{ num_gaveta: 31, peso_lb: 5 }] }));
ok('una gaveta fuera de 1 a 30 se rechaza', !!z.e, JSON.stringify(z));
z = await api(OPER, 'api_m01_guardar_recepcion', completa('P7-F', { gavetas: [{ num_gaveta: 1, peso_lb: 0 }] }));
ok('un peso de gaveta en cero se rechaza', !!z.e, JSON.stringify(z));
z = await api(OPER, 'api_m01_guardar_recepcion', completa('P7-G', { almacenamiento: [{ num_bin: 'B1', libras_aprox: 0 }], temperaturas: [] }));
ok('libras aproximadas en cero se rechazan', !!z.e, JSON.stringify(z));

console.log('\nEditar reemplaza los hijos');
const e1 = await api(OPER, 'api_m01_guardar_recepcion', completa('P7-A', { recepcion_id: c1.r.recepcion_id, version: c1.r.version, client_uuid: crypto.randomUUID(),
  gavetas: [{ num_gaveta: 2, peso_lb: 70 }], temperaturas: [{ lectura_id: 1, num_gaveta: 2, temperatura_c: 0 }],
  almacenamiento: [{ num_bin: 'B2', sellos_recepcion: 'SR-2', libras_aprox: 150 }] }));
const v2 = await ver(c1.r.recepcion_id, OPER);
ok('al editar quedan solo los datos nuevos', e1.r?.version === 2 && v2.gavetas.length === 1 && v2.gavetas[0].num_gaveta === 2 && v2.almacenamiento.length === 1 && v2.temperaturas.length === 1, JSON.stringify(e1));

const cuenta = async (sql) => Number((await db.query(sql)).rows[0].n);

console.log('\nTemperaturas por gaveta (hasta 30)');
const gav30 = Array.from({ length: 30 }, (_, i) => ({ num_gaveta: i + 1, peso_lb: 40 + i }));
const t30 = Array.from({ length: 30 }, (_, i) => ({ lectura_id: i + 1, num_gaveta: i + 1, temperatura_c: i / 10 - 1 }));
z = await api(OPER, 'api_m01_guardar_recepcion', nueva('P7-T30', { num_gavetas_bines: 30, gavetas: gav30, temperaturas: t30 }));
ok('se guardan 30 temperaturas, una por gaveta', !!z.r?.recepcion_id && (await ver(z.r.recepcion_id, OPER)).temperaturas.length === 30, JSON.stringify(z));
z = await api(OPER, 'api_m01_guardar_recepcion', nueva('P7-T2', { num_gavetas_bines: 3, gavetas: [{ num_gaveta: 1, peso_lb: 50 }, { num_gaveta: 2, peso_lb: 51 }, { num_gaveta: 3, peso_lb: 52 }], temperaturas: [{ lectura_id: 1, num_gaveta: 3, temperatura_c: 1.5 }, { lectura_id: 2, num_gaveta: 1, temperatura_c: -0.5 }] }));
ok('por defecto basta con 2 gavetas con temperatura (las demás sin dato)', !!z.r?.recepcion_id && (await ver(z.r.recepcion_id, OPER)).temperaturas.length === 2 , JSON.stringify(z));
z = await api(OPER, 'api_m01_guardar_recepcion', nueva('P7-T0', { temperaturas: [] }));
ok('una recepción sin temperaturas también se guarda', !!z.r?.recepcion_id, JSON.stringify(z));

console.log('\nUn proveedor con varios lotes');
const l1 = await api(OPER, 'api_m01_guardar_recepcion', nueva('P7-L1', { lote_id: '971-971-971', proveedor: 'Prov Multi', especie: 'Esp' }));
const l2 = await api(OPER, 'api_m01_guardar_recepcion', nueva('P7-L2', { lote_id: '972-972-972', proveedor: 'Prov Multi', especie: 'Esp' }));
const l3 = await api(OPER, 'api_m01_guardar_recepcion', nueva('P7-L3', { lote_id: '973-973-973', proveedor: 'prov  multi', especie: 'Esp' }));
ok('el mismo proveedor entrega el mismo día con tres lotes distintos', !!l1.r && !!l2.r && !!l3.r, JSON.stringify([l1, l2, l3]));
ok('el proveedor existe una sola vez (no se duplica por escribirlo distinto)', (await cuenta(`select count(*) n from core.proveedores where nombre_normalizado = 'PROV MULTI'`)) === 1);
ok('los tres lotes pertenecen a ese proveedor', (await cuenta(`select count(*) n from core.lotes l join core.proveedores p on p.id = l.proveedor_id where p.nombre_normalizado = 'PROV MULTI'`)) === 3);
z = await api(OPER, 'api_m01_guardar_recepcion', nueva('P7-L4', { lote_id: '972-972-972', proveedor: 'Otro Proveedor' }));
ok('un lote existente conserva su proveedor aunque se escriba otro', !!z.r && (await ver(z.r.recepcion_id, OPER)).proveedor_nombre === 'Prov Multi', JSON.stringify(z));

console.log('\nCierre de lote');
const R = (guia, extra) => api(OPER, 'api_m01_guardar_recepcion', nueva(guia, { lote_id: '974-974-974', proveedor: 'Prov Cierre', especie: 'Esp', ...extra }));
let c = await R('P7-C1', {});
ok('sin indicar nada, el lote sigue abierto', c.r?.lote_cerrado === false && (await api(OPER, 'api_obtener_lote', '974-974-974')).r.cerrado === false, JSON.stringify(c));
c = await R('P7-C2', { cerrar_lote: false });
ok('segundo camión del mismo lote con el lote abierto', c.r?.lote_cerrado === false && (await api(OPER, 'api_obtener_lote', '974-974-974')).r.camiones === 2, JSON.stringify(c));
c = await R('P7-C3', { estado: 'borrador', cerrar_lote: true, libras_planta: null, gavetas: [] });
ok('en un borrador no se cierra el lote aunque se pida', c.r?.lote_cerrado === false, JSON.stringify(c));
c = await R('P7-C4', { cerrar_lote: true });
ok('el último camión cierra el lote', c.r?.lote_cerrado === true, JSON.stringify(c));
const info = (await api(OPER, 'api_obtener_lote', '974-974-974')).r;
ok('api_obtener_lote informa que está cerrado y suma los 4 camiones (uno es borrador)', info.cerrado === true && info.camiones === 4 && !!info.cerrado_en, JSON.stringify(info));
c = await R('P7-C5', {});
ok('un lote cerrado no admite recepciones nuevas', err(c, 'E_ESTADO'), JSON.stringify(c));
c = await api(OPER, 'api_m01_guardar_recepcion', nueva('P7-C6', { lote_id: '975-975-975', proveedor: 'Prov Cierre', especie: 'Esp' }));
c = await api(OPER, 'api_m01_guardar_recepcion', { ...nueva('P7-C6', { lote_id: '975-975-975', proveedor: 'Prov Cierre', especie: 'Esp' }), recepcion_id: c.r.recepcion_id, version: c.r.version, client_uuid: crypto.randomUUID(), lote_id: '974-974-974' });
ok('tampoco se puede mover una recepción a un lote cerrado', err(c, 'E_ESTADO'), JSON.stringify(c));
const idC4 = (await db.query(`select recepcion_id, version from m01_recepcion.recepciones where guia_remision='P7-C4'`)).rows[0];
c = await api(OPER, 'api_m01_guardar_recepcion', { ...nueva('P7-C4', { lote_id: '974-974-974' }), recepcion_id: idC4.recepcion_id, version: idC4.version, client_uuid: crypto.randomUUID(), observacion: 'corregida' });
ok('una recepción que ya estaba en el lote cerrado sí se puede editar', !!c.r?.recepcion_id, JSON.stringify(c));
c = await api(OPER, 'api_m01_reabrir_lote', '974-974-974');
ok('el operativo no puede reabrir un lote', err(c, 'E_PERMISO'), JSON.stringify(c));
c = await api(ADMIN, 'api_m01_reabrir_lote', '974-974-974');
ok('el administrador reabre el lote', c.r?.cerrado === false, JSON.stringify(c));
c = await R('P7-C7', {});
ok('reabierto, admite otro camión', !!c.r?.recepcion_id, JSON.stringify(c));
c = await api(OPER, 'api_m01_cerrar_lote', '974-974-974');
ok('se puede cerrar el lote después, sin grabar una recepción', c.r?.cerrado === true, JSON.stringify(c));
c = await api(OPER, 'api_m01_cerrar_lote', '974-974-974');
ok('cerrar un lote ya cerrado avisa', err(c, 'E_ESTADO'), JSON.stringify(c));
c = await api(OPER, 'api_m01_cerrar_lote', '999-999-998');
ok('cerrar un lote que no existe avisa', err(c, 'E_NO_ENCONTRADO'), JSON.stringify(c));
c = await api(CONS, 'api_m01_cerrar_lote', '974-974-974');
ok('el usuario de solo consulta no puede cerrar lotes', err(c, 'E_PERMISO'), JSON.stringify(c));
ok('queda rastro en la auditoría', (await cuenta(`select count(*) n from core.auditoria where accion in ('cerrar_lote','reabrir_lote')`)) >= 3);


console.log('\nBines o gavetas y nombre del usuario');
z = await api(OPER, 'api_m01_guardar_recepcion', nueva('P7-LL1', { lote_id: '976-976-976', proveedor: 'Prov LL', especie: 'Esp' }));
ok('sin indicarlo, el producto llega en bines', !!z.r && (await ver(z.r.recepcion_id, OPER)).llegada_en === 'bines', JSON.stringify(z));
z = await api(OPER, 'api_m01_guardar_recepcion', nueva('P7-LL2', { lote_id: '976-976-976', llegada_en: 'gavetas', num_gavetas_bines: 12 }));
const vLL = z.r ? await ver(z.r.recepcion_id, OPER) : null;
ok('se guarda que llegó en gavetas', vLL?.llegada_en === 'gavetas' && vLL?.num_gavetas_bines === 12, JSON.stringify(z));
z = await api(OPER, 'api_m01_guardar_recepcion', { ...nueva('P7-LL2', { lote_id: '976-976-976', llegada_en: 'bines', num_gavetas_bines: 4 }), recepcion_id: z.r.recepcion_id, version: z.r.version, client_uuid: crypto.randomUUID() });
ok('al editar se puede cambiar a bines', !!z.r && (await ver(z.r.recepcion_id, OPER)).llegada_en === 'bines', JSON.stringify(z));
z = await api(OPER, 'api_m01_guardar_recepcion', nueva('P7-LL3', { lote_id: '976-976-976', llegada_en: 'cajas' }));
ok('un valor distinto de bines o gavetas se rechaza', err(z, 'E_VALIDACION'), JSON.stringify(z));
z = await api(OPER, 'api_m01_guardar_recepcion', nueva('P7-LL4', { lote_id: '976-976-976', llegada_en: 'gavetas', num_gavetas_bines: 0 }));
ok('el número en cero se rechaza con el tipo en el mensaje', err(z, 'E_VALIDACION') && /gavetas/.test(z.e), JSON.stringify(z));
const nom = await db.query(`select core.asignar_nombre_usuario('OP@x.com', '  Pedro   Luis ') as n`);
ok('se asigna el nombre del usuario por su correo (sin importar mayúsculas ni espacios)', nom.rows[0].n === 'Pedro Luis');
ok('el perfil muestra el nombre nuevo', (await api(OPER, 'api_mi_perfil')).r?.nombre === 'Pedro Luis', JSON.stringify(await api(OPER, 'api_mi_perfil')));
try { await db.query(`select core.asignar_nombre_usuario('nadie@x.com', 'X')`); ok('un correo inexistente falla', false); } catch (e) { ok('un correo inexistente falla', /No existe un usuario/.test(e.message)); }
try { await db.query(`select core.asignar_nombre_usuario('op@x.com', '   ')`); ok('un nombre vacío falla', false); } catch (e) { ok('un nombre vacío falla', /obligatorio/.test(e.message)); }
const perm = await como(OPER, `select core.asignar_nombre_usuario('op@x.com', 'Hack')`);
ok('un usuario de la aplicación no puede cambiar nombres con esa función', !!perm.e, JSON.stringify(perm));

console.log('\nDatos de demostración');
const cargar = fs.readFileSync(path.join(docs, 'datos_demo_cargar.sql'), 'utf8');
const borrar = fs.readFileSync(path.join(docs, 'datos_demo_borrar.sql'), 'utf8');
try { await db.exec(cargar); ok('el script de carga se ejecuta sin errores', true); } catch (e) { ok('el script de carga se ejecuta sin errores', false, e.message); }
ok('crea 8 recepciones DEMO', (await cuenta(`select count(*) n from m01_recepcion.recepciones where guia_remision like 'DEMO-%'`)) === 8);
ok('hay cerradas, borradores y una anulada', (await cuenta(`select count(*) n from m01_recepcion.recepciones where guia_remision like 'DEMO-%' and estado='cerrado'`)) === 5
  && (await cuenta(`select count(*) n from m01_recepcion.recepciones where guia_remision like 'DEMO-%' and estado='borrador'`)) === 2
  && (await cuenta(`select count(*) n from m01_recepcion.recepciones where guia_remision like 'DEMO-%' and estado='anulado'`)) === 1);
ok('la recepción de 30 gavetas quedó completa', (await cuenta(`select count(*) n from m01_recepcion.recepcion_gavetas g join m01_recepcion.recepciones r on r.recepcion_id=g.recepcion_id where r.guia_remision='DEMO-003'`)) === 30);
const lt = await api(OPER, 'api_obtener_lote', '981-981-981');
ok('el lote 981 tiene 2 camiones y 1220 libras reportadas', lt.r?.camiones === 2 && Number(lt.r.libras_reportadas) === 1220, JSON.stringify(lt));
ok('quedan datos con temperaturas negativas', (await cuenta(`select count(*) n from m01_recepcion.recepcion_temperaturas where temperatura_c < 0`)) >= 2);
try { await db.exec(cargar); ok('cargar dos veces se rechaza con un mensaje claro', false); } catch (e) { ok('cargar dos veces se rechaza con un mensaje claro', /Ya hay datos de demostración/.test(e.message), e.message); }
ok('tras el rechazo no se duplicó nada', (await cuenta(`select count(*) n from m01_recepcion.recepciones where guia_remision like 'DEMO-%'`)) === 8);
try { await db.exec(borrar); ok('el script de borrado se ejecuta sin errores', true); } catch (e) { ok('el script de borrado se ejecuta sin errores', false, e.message); }
ok('no queda ninguna recepción DEMO ni hijos', (await cuenta(`select count(*) n from m01_recepcion.recepciones where guia_remision like 'DEMO-%'`)) === 0
  && (await cuenta(`select count(*) n from core.lotes where lote_id in ('981-981-981','982-982-982','983-983-983')`)) === 0
  && (await cuenta(`select count(*) n from core.proveedores where nombre like 'DEMO %'`)) === 0
  && (await cuenta(`select count(*) n from core.especies where nombre like 'DEMO %'`)) === 0);
ok('no tocó las recepciones reales (la de la prueba sigue)', (await cuenta(`select count(*) n from m01_recepcion.recepciones where guia_remision='P7-A'`)) === 1);
try { await db.exec(borrar); ok('borrar otra vez no hace daño', true); } catch (e) { ok('borrar otra vez no hace daño', false, e.message); }
try { await db.exec(cargar); ok('después de borrar se puede cargar de nuevo', true); await db.exec(borrar); } catch (e) { ok('después de borrar se puede cargar de nuevo', false, e.message); }

console.log(`\nRESULTADO: ${pass} correctas, ${fail} con fallo.`);
process.exit(fail ? 1 : 0);
