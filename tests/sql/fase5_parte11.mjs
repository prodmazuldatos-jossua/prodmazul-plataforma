// Prueba automática de la Fase 5 · Parte 11: restauración desde Google Sheets. Aplica las migraciones 1 a 20 en una base PostgreSQL simulada (PGlite)
// con datos de prueba, genera los CSV como los deja Google Sheets, reconstruye una base vacía con herramientas/restaurar-desde-sheets.mjs
// y comprueba que las dos bases quedan idénticas.
// pg_cron, pg_net y Vault se sustituyen por dobles mínimos (en Supabase son los reales).
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(aqui, '../../supabase/migrations');
import { construirSql, TABLAS } from '../../herramientas/restaurar-desde-sheets.mjs';

async function crearBase() {
  const db = new PGlite();
  const ADMIN = '00000000-0000-0000-0000-000000000001';
  const OPER = '00000000-0000-0000-0000-000000000002';

  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true),''), nullif(current_setting('request.jwt.sub', true),''))::uuid $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
    grant usage on schema public to anon, authenticated;
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


  for (const f of fs.readdirSync(dir).sort()) {
    try { await db.exec(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^create extension.*$/gm, '')); }
    catch (e) { console.log('  ✘ se aplica', f, e.message); process.exit(1); }
  }
  await db.exec(`
    insert into auth.users(id,email) values ('${ADMIN}','admin@x.com'),('${OPER}','op@x.com');
    update core.perfiles set es_admin_general = true, nombre = 'Admin' where user_id = '${ADMIN}';
    insert into core.usuario_modulo_rol values ('${OPER}','M01','operativo');
  `);
  return db;
}

const ADMIN = '00000000-0000-0000-0000-000000000001';
let ok = 0, mal = 0; const txt = [];
const ck = (c, m) => { if (c) { ok++; } else { mal++; txt.push('  FALLÓ: ' + m); } };
const comoAdmin = (db, sql) => db.exec(`select set_config('request.jwt.claims', '{"sub":"${ADMIN}","role":"authenticated"}', true), set_config('request.jwt.claim.sub', '${ADMIN}', true); set local role authenticated; ${sql}; reset role;`);

// ---- 1) base de origen con datos (incluye comillas, comas, saltos de línea, acentos y una foto ya purgada)
const A = await crearBase();
await A.exec(`
  do $$ declare v_r jsonb; v_rid text; begin
    perform set_config('request.jwt.claims', '{"sub":"${ADMIN}","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '${ADMIN}', true);
    set local role authenticated;
    v_r := public.api_m01_guardar_recepcion(jsonb_build_object('estado','cerrado','fecha_llegada',(now() at time zone 'America/Guayaquil')::date,'lote_id','961-961-961',
      'proveedor','ZZ Restauración Ñandú, "S.A."','especie','ZZ Entero','num_gavetas_bines',2,'libras_reportadas',1000.5,'libras_planta',990.25,'guia_remision','G-R-1',
      'observacion',E'línea 1\nlínea 2, con coma y "comillas"','cerrar_lote',true,
      'gavetas', jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',500.25),jsonb_build_object('num_gaveta',2,'peso_lb',490)),'client_uuid',gen_random_uuid()));
    v_rid := v_r->>'recepcion_id';
    reset role;
    insert into m01_recepcion.fotos_meta (foto_id, recepcion_id, lote_id, nn, ruta, nombre, tipo_mime, tamano_bytes, confirmada, subido_en, drive_file_id, respaldo_drive_en, purgada_supabase_en) values
      ('FOT-R-1', v_rid, '961-961-961', 1, 'M01/961/'||v_rid||'/f1.jpg','f.jpg','image/jpeg', 100, true, now()-interval '90 days','DRV1', now()-interval '80 days', now()-interval '70 days'),
      ('FOT-R-2', v_rid, '961-961-961', 2, 'M01/961/'||v_rid||'/f2.png','f.png','image/png', 80, true, now(),null,null,null);
  end $$;`);

// ---- 2) lo que Google Sheets guarda (receptor: null → vacío, sí/no → TRUE/FALSE, objetos → texto JSON) y baja como CSV
const celda = (v) => v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? String(v) : typeof v === 'object' ? JSON.stringify(v) : String(v);
const esc = (s) => /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
const claves = { proveedores: ['id'], especies: ['id'], lotes: ['lote_id'], perfiles: ['user_id'], usuario_modulo_rol: ['user_id', 'modulo_id'], config: ['clave'], recepciones: ['recepcion_id'], recepcion_gavetas: ['recepcion_id', 'num_gaveta'], recepcion_temperaturas: ['recepcion_id', 'lectura_id'], recepcion_almacenamiento: ['recepcion_id', 'num_bin'], fotos_meta: ['foto_id'] };
const csv = {};
for (const t of TABLAS) {
  const filas = (await A.query(`select to_jsonb(t) as j from ${t.tabla} t`)).rows.map((r) => r.j);
  const k = claves[t.hoja];
  const cab = [...k, ...[...new Set(filas.flatMap((f) => Object.keys(f)).filter((c) => !k.includes(c)))].sort(), 'sincronizado_en'];
  csv[t.hoja] = [cab.join(','), ...filas.map((f) => cab.map((c) => esc(c === 'sincronizado_en' ? '2026-10-26T12:00:00-05:00' : celda(f[c]))).join(','))].join('\r\n') + '\r\n';
}
console.log('\nRestauración desde Google Sheets (CSV → base vacía)');

// ---- 3) base de destino vacía (desastre): sin datos, con las cuentas de acceso y perfiles en blanco
const B = await crearBase();
await B.exec(`update core.perfiles set es_admin_general = false, nombre = ''; delete from core.usuario_modulo_rol;`);
const { sql, resumen } = construirSql(csv, { incluirUsuarios: true, incluirConfig: true });
await B.exec(sql);
const huella = async (db, t) => (await db.query(`select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) as h from ${t} t`)).rows[0].h;
for (const t of TABLAS) ck((await huella(A, t.tabla)) === (await huella(B, t.tabla)), `${t.tabla} debe quedar idéntica a la original`);
ck((await B.query(`select count(*)::int as n from m01_recepcion.recepciones`)).rows[0].n === 1, 'reaparece la recepción');
ck((await B.query(`select count(*)::int as n from m01_recepcion.recepcion_gavetas`)).rows[0].n === 2, 'reaparecen las 2 gavetas');
ck((await B.query(`select count(*)::int as n from m01_recepcion.fotos_meta where purgada_supabase_en is not null`)).rows[0].n === 1, 'la foto purgada conserva su marca');
ck((await B.query(`select proveedor_id is not null as ok from core.lotes`)).rows[0].ok, 'el lote conserva su proveedor');
ck((await B.query(`select nombre from core.proveedores`)).rows[0].nombre === 'ZZ Restauración Ñandú, "S.A."', 'comillas, comas y acentos intactos');
ck((await B.query(`select observacion from m01_recepcion.recepciones`)).rows[0].observacion === 'línea 1\nlínea 2, con coma y "comillas"', 'el salto de línea de la observación sobrevive');
ck((await B.query(`select cerrado from core.lotes`)).rows[0].cerrado === true, 'el lote sigue cerrado');
ck((await B.query(`select es_admin_general from core.perfiles where user_id = '${ADMIN}'`)).rows[0].es_admin_general === true, 'el administrador recupera su marca');
ck((await B.query(`select valor from core.config where clave = 'sync_activa'`)).rows[0].valor === false, 'los sí/no de la configuración vuelven como sí/no');
ck(resumen.every((r) => !r.omitida), 'ninguna hoja omitida con las dos opciones');

// ---- 4) repetir no duplica ni cambia nada
const antes = []; for (const t of TABLAS) antes.push(await huella(B, t.tabla));
await B.exec(sql);
const despues = []; for (const t of TABLAS) despues.push(await huella(B, t.tabla));
ck(JSON.stringify(antes) === JSON.stringify(despues), 'ejecutar dos veces la restauración no cambia nada');

// ---- 5) el sistema sigue funcionando: la numeración no repite números
await comoAdmin(B, `select public.api_m01_guardar_recepcion(jsonb_build_object('estado','cerrado','fecha_llegada',(now() at time zone 'America/Guayaquil')::date,'lote_id','962-962-962','proveedor','ZZ Otro','especie','ZZ Entero','num_gavetas_bines',1,'libras_reportadas',100,'libras_planta',99,'guia_remision','G-R-2','gavetas',jsonb_build_array(jsonb_build_object('num_gaveta',1,'peso_lb',99)),'client_uuid',gen_random_uuid()))`);
const ids = (await B.query(`select recepcion_id from m01_recepcion.recepciones order by 1`)).rows.map((r) => r.recepcion_id);
ck(ids.length === 2 && new Set(ids).size === 2 && ids[1].endsWith('0002'), 'la recepción nueva toma el número siguiente (' + ids.join(', ') + ')');

// ---- 6) restauración sin usuarios ni configuración (modo por defecto) en otra base vacía y SIN cuentas
const C = await crearBase();
await C.exec(`delete from core.usuario_modulo_rol; delete from core.perfiles; delete from auth.users;`);
const r0 = construirSql(csv);
await C.exec(r0.sql);
ck((await C.query(`select count(*)::int as n from m01_recepcion.recepciones`)).rows[0].n === 1, 'sin cuentas: la recepción reaparece igual');
ck((await C.query(`select realizado_por from m01_recepcion.recepciones`)).rows[0].realizado_por === null, 'sin perfil, «realizado por» queda vacío en vez de fallar');
ck((await C.query(`select count(*)::int as n from core.perfiles`)).rows[0].n === 0, 'no se crearon perfiles sin cuenta');

console.log(`  ${mal === 0 ? '✔' : '✘'} ${ok} correctas, ${mal} con fallo${txt.length ? '\n' + txt.join('\n') : ''}`);
console.log(mal === 0 ? '\nTodo correcto.' : '\nHay fallos.');
process.exit(mal ? 1 : 0);
