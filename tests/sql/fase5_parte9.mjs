// Prueba automática de la Fase 5 · Parte 9: aplica las migraciones 1 a 19 en una base PostgreSQL simulada (PGlite)
// y ejecuta el mismo archivo de prueba que corres en Supabase (docs/prueba_parte9_f5.sql).
// pg_cron, pg_net y Vault se sustituyen por dobles mínimos (en Supabase son los reales).
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(aqui, '../../supabase/migrations');
const prueba = fs.readFileSync(path.resolve(aqui, '../../docs/prueba_parte9_f5.sql'), 'utf8');
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

let fallos = 0;
console.log('\nMigraciones');
for (const f of fs.readdirSync(dir).sort()) {
  try { await db.exec(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^create extension.*$/gm, '')); console.log('  ✔ se aplica', f); }
  catch (e) { console.log('  ✘ se aplica', f, e.message); process.exit(1); }
}
await db.exec(`
  insert into auth.users(id,email) values ('${ADMIN}','admin@x.com'),('${OPER}','op@x.com');
  update core.perfiles set es_admin_general = true, nombre = 'Admin' where user_id = '${ADMIN}';
  insert into core.usuario_modulo_rol values ('${OPER}','M01','operativo');
`);

async function correr(titulo) {
  console.log('\n' + titulo);
  const sql = prueba;
  try { await db.exec(sql); console.log('  ✘ la prueba debía terminar con el mensaje de resultado'); fallos++; }
  catch (e) {
    const m = /PRUEBAS DE LA FASE 5 · PARTE 9: (\d+) correctas, (\d+) con fallo\.([\s\S]*)/.exec(e.message);
    if (!m) { console.log('  ✘ error inesperado:', e.message); fallos++; return; }
    console.log(`  ${m[2] === '0' ? '✔' : '✘'} ${m[1]} correctas, ${m[2]} con fallo${m[3] ? '\n' + m[3] : ''}`);
    if (m[2] !== '0') fallos++;
  }
}
await correr('Prueba de la migración 19');
console.log(fallos === 0 ? '\nTodo correcto.' : '\nHay fallos.');
process.exit(fallos ? 1 : 0);
