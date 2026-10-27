// Verificador de seguridad (Fase 5 · Parte 9). Sin dependencias: solo Node.
// Uso (desde la carpeta del repositorio):   node herramientas/verificar-seguridad.mjs
// Busca claves que NUNCA deben estar en el código, en Git ni en la aplicación publicada:
//   - la clave de administración de Supabase («service_role» / «sb_secret_…») en cualquier archivo de Git o en apps/web (código y dist);
//   - claves privadas, archivos .env en Git, variables VITE_ con nombre de secreto;
//   - la dirección del receptor de Google (es un secreto de acceso) en archivos de Git.
// NUNCA imprime el valor encontrado: solo el archivo, la línea y qué tipo de dato es.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const EXT_BINARIAS = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|eot|zip|gz|pdf|xlsx|docx|mp4|mov|wasm|br)$/i;
const IGNORAR_DIR = new Set(['node_modules', '.git', '.wrangler', '.vite', 'backups']);
const MAX_BYTES = 5 * 1024 * 1024;

export function decodificarJwt(t) {
  try {
    const [h, p, f] = t.split('.');
    if (!h || !p || f === undefined) return null;
    const json = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    return typeof json === 'object' && json ? json : null;
  } catch { return null; }
}

function listarGit(raiz) {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: raiz, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
    return out.split('\0').filter(Boolean);
  } catch { return null; }
}
function caminar(dir, base, acc = []) {
  let ents = [];
  try { ents = fs.readdirSync(path.join(base, dir), { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (IGNORAR_DIR.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) caminar(rel, base, acc); else acc.push(rel);
  }
  return acc;
}

const enNavegador = (rel) => /^apps\/web\/(src|dist|public|index\.html)/.test(rel) || /^web\/(src|dist)/.test(rel);
const esPrueba = (rel) => /(\.test\.|\/tests?\/|\/docs\/|\.md$|LEEME)/i.test(rel);
const mascara = (s) => (s.length > 8 ? `${s.slice(0, 4)}…(${s.length} caracteres)` : '…');

export function verificar(raiz) {
  const hallazgos = []; // { nivel: 'CRITICO' | 'AVISO', archivo, linea, texto }
  const add = (nivel, archivo, linea, texto) => hallazgos.push({ nivel, archivo, linea, texto });

  const git = listarGit(raiz);
  const rastreados = new Set(git ?? []);
  const archivos = new Set(git ?? caminar('', raiz));
  // La aplicación compilada (dist) normalmente no está en Git: se revisa aparte porque es lo que se publica.
  for (const d of ['apps/web/dist', 'web/dist']) if (fs.existsSync(path.join(raiz, d))) caminar(d, raiz).forEach((f) => archivos.add(f));

  let revisados = 0;
  for (const rel of [...archivos].sort()) {
    const nombre = path.basename(rel);
    // Archivos .env: nunca deben estar en Git.
    if (/^\.env(\..+)?$/.test(nombre) && !/\.(example|sample|template)$/.test(nombre)) {
      if (git ? rastreados.has(rel) : true) add(git ? 'CRITICO' : 'AVISO', rel, 0, git ? 'Archivo de variables (.env) dentro de Git: sácalo con «git rm --cached» y rota las claves que contenga.' : 'Existe un archivo .env: comprueba que NO está en Git (usa «git status»).');
    }
    if (EXT_BINARIAS.test(rel)) continue;
    const abs = path.join(raiz, rel);
    let st; try { st = fs.statSync(abs); } catch { continue; }
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    let txt; try { txt = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (txt.includes('\u0000')) continue;
    revisados++;
    const navegador = enNavegador(rel);
    const lineas = txt.split(/\r?\n/);
    lineas.forEach((l, i) => {
      const n = i + 1;
      // 1) Tokens JWT: la clave de administración (role=service_role) jamás.
      for (const m of l.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g)) {
        const p = decodificarJwt(m[0]);
        if (p?.role === 'service_role') add('CRITICO', rel, n, `Clave de administración de Supabase (service_role) escrita en el archivo: ${mascara(m[0])}. Rótala en Supabase y quítala.`);
      }
      // 2) Claves nuevas de Supabase.
      for (const m of l.matchAll(/sb_secret_[A-Za-z0-9_-]{8,}/g)) add('CRITICO', rel, n, `Clave secreta de Supabase (sb_secret_…) escrita en el archivo: ${mascara(m[0])}.`);
      // 3) Claves privadas.
      if (/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(l)) add('CRITICO', rel, n, 'Clave privada dentro del archivo.');
      // 4) En el navegador no puede existir ninguna referencia a la clave de administración.
      if (navegador && /service[_-]?role|SERVICE_ROLE_KEY/i.test(l) && !esPrueba(rel)) add('CRITICO', rel, n, 'La aplicación web menciona la clave de administración (service_role): esa clave solo puede existir en el servidor.');
      // 5) Variables VITE_ con nombre de secreto (Vite las incluye en el navegador).
      for (const m of l.matchAll(/VITE_[A-Z0-9_]*(SERVICE|SECRET|PRIVATE|PASSWORD|TOKEN)[A-Z0-9_]*/g)) {
        if (!esPrueba(rel)) add('CRITICO', rel, n, `Variable ${m[0]}: todo lo que empieza con VITE_ se publica en el navegador. No uses ese nombre para secretos.`);
      }
      // 6) La clave de servicio fuera del servidor solo se admite leída del entorno.
      if (/SERVICE_ROLE_KEY\s*[:=]\s*['"`][^'"`\s]{20,}['"`]/.test(l)) add('CRITICO', rel, n, 'La clave de servicio está escrita en el código: debe leerse con Deno.env.get(…).');
      // 7) Dirección del receptor de Google (es un secreto de acceso).
      if (rastreados.has(rel) || !git) {
        for (const m of l.matchAll(/https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]{20,})\/exec/g)) {
          if (!/(PRUEBA|EJEMPLO|XXXX|TU_ID|ID_DE)/i.test(m[1])) add('CRITICO', rel, n, `Dirección real del receptor de Google dentro de Git: ${mascara(m[1])}. Va solo en la base de datos (Vault), no en archivos.`);
        }
      }
      // 8) Asignaciones sospechosas de secretos largos (aviso, no bloquea).
      if (!esPrueba(rel)) {
        const m = /\b(password|passwd|clave|secret|api[_-]?key|token)\b\s*[:=]\s*['"`]([A-Za-z0-9+/_=-]{24,})['"`]/i.exec(l);
        if (m && !/process\.env|Deno\.env|import\.meta\.env/.test(l)) add('AVISO', rel, n, `Posible secreto escrito en el código (${m[1]} = ${mascara(m[2])}). Revísalo.`);
      }
    });
  }

  // .gitignore debe cubrir lo básico.
  try {
    const gi = fs.readFileSync(path.join(raiz, '.gitignore'), 'utf8');
    for (const [clave, re] of [['.env.local', /\.env/], ['node_modules', /node_modules/], ['dist', /(^|\/)dist/m], ['backups', /backups/]]) {
      if (!re.test(gi)) add('AVISO', '.gitignore', 0, `El archivo .gitignore no menciona «${clave}».`);
    }
  } catch { add('AVISO', '.gitignore', 0, 'No existe el archivo .gitignore en la carpeta del repositorio.'); }

  // La función de servidor lee la clave solo del entorno.
  const fn = 'supabase/functions/admin-usuarios/index.ts';
  if (fs.existsSync(path.join(raiz, fn))) {
    const t = fs.readFileSync(path.join(raiz, fn), 'utf8');
    if (!/Deno\.env\.get\(\s*['"]SUPABASE_SERVICE_ROLE_KEY['"]\s*\)/.test(t)) add('AVISO', fn, 0, 'La función admin-usuarios no lee SUPABASE_SERVICE_ROLE_KEY del entorno.');
  }
  return { hallazgos, revisados, usaGit: git !== null };
}

// ---- ejecución por línea de comandos ----
const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (esPrincipal) {
  const raiz = path.resolve(process.argv[2] ?? process.cwd());
  const r = verificar(raiz);
  const crit = r.hallazgos.filter((h) => h.nivel === 'CRITICO');
  const avis = r.hallazgos.filter((h) => h.nivel === 'AVISO');
  console.log(`\nVerificador de seguridad · ${r.revisados} archivos revisados${r.usaGit ? ' (los de Git + la aplicación compilada)' : ' (sin Git: se revisó toda la carpeta)'}`);
  for (const h of crit) console.log(`  ✘ CRÍTICO  ${h.archivo}${h.linea ? ':' + h.linea : ''}\n             ${h.texto}`);
  for (const h of avis) console.log(`  ! aviso    ${h.archivo}${h.linea ? ':' + h.linea : ''}\n             ${h.texto}`);
  if (crit.length === 0) console.log(avis.length ? `\n✔ Sin hallazgos críticos (${avis.length} aviso${avis.length === 1 ? '' : 's'} para revisar).` : '\n✔ Sin hallazgos.');
  else console.log(`\n✘ ${crit.length} hallazgo${crit.length === 1 ? '' : 's'} crítico${crit.length === 1 ? '' : 's'}. Corrígelos antes de seguir (y rota las claves expuestas).`);
  process.exit(crit.length ? 1 : 0);
}
