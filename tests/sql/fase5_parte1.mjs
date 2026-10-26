// Prueba automática de la Fase 5 · Parte 1: aplica TODAS las migraciones (1 a 13) en una base PostgreSQL simulada (PGlite)
// y ejecuta el mismo archivo de prueba que corres en Supabase (docs/prueba_parte1_f5.sql).
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(aqui, '../../supabase/migrations');
const prueba = fs.readFileSync(path.resolve(aqui, '../../docs/prueba_parte1_f5.sql'), 'utf8');
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
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  grant usage on schema public to anon, authenticated;
`);

let fallos = 0;
console.log('\nMigraciones');
for (const f of fs.readdirSync(dir).sort()) {
  try { await db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); console.log('  ✔ se aplica', f); }
  catch (e) { console.log('  ✘ se aplica', f, e.message); process.exit(1); }
}
await db.exec(`
  insert into auth.users(id,email) values ('${ADMIN}','admin@x.com'),('${OPER}','op@x.com');
  update core.perfiles set es_admin_general = true, nombre = 'Admin' where user_id = '${ADMIN}';
  insert into core.usuario_modulo_rol values ('${OPER}','M01','operativo');
`);

console.log('\nPrueba de la cola y el estado de sincronización');
try {
  await db.exec(prueba);
  console.log('  ✘ la prueba debía terminar con el mensaje de resultado'); fallos++;
} catch (e) {
  const m = /PRUEBAS DE LA FASE 5 · PARTE 1: (\d+) correctas, (\d+) con fallo\.([\s\S]*)/.exec(e.message);
  if (!m) { console.log('  ✘ error inesperado:', e.message); fallos++; }
  else {
    console.log(`  ${m[2] === '0' ? '✔' : '✘'} ${m[1]} correctas, ${m[2]} con fallo${m[3] ? '\n' + m[3] : ''}`);
    if (m[2] !== '0') fallos++;
  }
}
console.log(fallos === 0 ? '\nTodo correcto.' : '\nHay fallos.');
process.exit(fallos === 0 ? 0 : 1);
