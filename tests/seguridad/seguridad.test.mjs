// Pruebas del verificador de seguridad: proyectos de mentira con y sin claves expuestas.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { verificar, decodificarJwt } from '../../herramientas/verificar-seguridad.mjs';

let ok = 0, mal = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('  ✔', n); } else { mal++; console.log('  ✘', n, x); } };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role, exp: 4102444800 })}.${'f'.repeat(30)}`;
const SERVICIO = jwt('service_role'); const ANON = jwt('anon');

function proyecto(archivos, { git = true } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-'));
  const base = {
    '.gitignore': '.env.local\nnode_modules\ndist\nbackups\n',
    'apps/web/src/main.tsx': 'const url = import.meta.env.VITE_SUPABASE_URL;\n',
    'supabase/functions/admin-usuarios/index.ts': "const k = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;\n",
  };
  for (const [f, c] of Object.entries({ ...base, ...archivos })) {
    if (c === null) continue;
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c);
  }
  if (git) { execFileSync('git', ['init', '-q'], { cwd: d }); execFileSync('git', ['add', '-A', '-f'], { cwd: d }); }
  return d;
}
const criticos = (r) => r.hallazgos.filter((h) => h.nivel === 'CRITICO');
const todoTexto = (r) => JSON.stringify(r.hallazgos);

console.log('\nProyecto limpio');
let r = verificar(proyecto({ 'apps/web/dist/assets/app.js': `const a="${ANON}";` }));
t('pasa (la clave anon es pública por diseño)', criticos(r).length === 0, todoTexto(r));
t('revisó los archivos', r.revisados >= 3);

console.log('\nClave de administración');
r = verificar(proyecto({ 'apps/web/src/api.ts': `const k = "${SERVICIO}";\n` }));
t('service_role en el código de la aplicación: crítico', criticos(r).some((h) => h.archivo.endsWith('api.ts')));
t('NO imprime la clave encontrada', !todoTexto(r).includes(SERVICIO) && !todoTexto(r).includes(SERVICIO.split('.')[1]));
r = verificar(proyecto({ 'apps/web/dist/assets/app.js': `x("${SERVICIO}")` }), {});
t('service_role en la aplicación compilada: crítico', criticos(r).length >= 1);
r = verificar(proyecto({ 'notas.txt': `la clave es ${SERVICIO}` }));
t('service_role en cualquier archivo de Git: crítico', criticos(r).length === 1);
r = verificar(proyecto({ 'scripts/x.js': 'const k = "sb_' + 'secret_AbCdEfGhIjKlMnOp12345";' }));
t('sb_secret_ en Git: crítico', criticos(r).length === 1 && !todoTexto(r).includes('AbCdEfGhIjKlMnOp12345'));
r = verificar(proyecto({ 'apps/web/src/cfg.ts': 'const x = import.meta.env.SERVICE_ROLE_KEY;' }));
t('mencionar SERVICE_ROLE_KEY en la aplicación web: crítico', criticos(r).length === 1);
r = verificar(proyecto({ 'apps/web/.env.production': 'VITE_SERVICE_KEY=abc' }));
t('variable VITE_ con nombre de secreto: crítico', criticos(r).some((h) => /VITE_SERVICE_KEY/.test(h.texto)));
r = verificar(proyecto({ 'supabase/functions/admin-usuarios/index.ts': 'const k = "abcdefghijklmnopqrstuvwxyz0123456789"; const SERVICE_ROLE' + '_KEY = "abcdefghijklmnopqrstuvwxyz0123456789";' }));
t('clave de servicio escrita en la función: crítico', criticos(r).length >= 1);
r = verificar(proyecto({ 'supabase/functions/admin-usuarios/index.ts': "const k = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;\n" }));
t('leer la clave del entorno en la función: permitido', criticos(r).length === 0);

console.log('\nOtros secretos');
r = verificar(proyecto({ '.env.local': 'X=1' }));
t('.env.local dentro de Git: crítico', criticos(r).some((h) => h.archivo === '.env.local'));
r = verificar(proyecto({ '.env.example': 'VITE_SUPABASE_URL=' }));
t('.env.example está permitido', criticos(r).length === 0);
r = verificar(proyecto({ 'k.pem': '-----BEGIN ' + 'PRIVATE KEY-----\nabc\n-----END ' + 'PRIVATE KEY-----' }));
t('clave privada: crítico', criticos(r).length === 1);
r = verificar(proyecto({ 'docs/a.md': 'URL: https://script.google.' + 'com/macros/s/AKfycbxREALREALREALREAL1234567/exec' }));
t('dirección real del receptor en Git: crítico', criticos(r).length === 1 && !todoTexto(r).includes('REALREALREAL'));
r = verificar(proyecto({ 'docs/a.md': 'URL: https://script.google.' + 'com/macros/s/AKfycbzPRUEBA123456789012345/exec' }));
t('dirección de ejemplo (PRUEBA): permitida', criticos(r).length === 0);
r = verificar(proyecto({ 'src/a.js': 'const password = "Abcdefghijklmnopqrstuvwxyz123";' }));
t('contraseña larga escrita en el código: aviso', r.hallazgos.some((h) => h.nivel === 'AVISO' && !todoTexto(r).includes('Abcdefghijklmnop')));
r = verificar(proyecto({ '.gitignore': 'x' }));
t('.gitignore incompleto: aviso', r.hallazgos.filter((h) => h.nivel === 'AVISO').length >= 3);

console.log('\nSin Git');
r = verificar(proyecto({ 'apps/web/src/api.ts': `const k = "${SERVICIO}";` }, { git: false }));
t('sin Git también revisa la carpeta', r.usaGit === false && criticos(r).length >= 1);

console.log('\nUtilidades y línea de comandos');
t('decodificarJwt lee el rol', decodificarJwt(SERVICIO)?.role === 'service_role' && decodificarJwt('basura') === null);
const d = proyecto({ 'apps/web/src/api.ts': `const k = "${SERVICIO}";` });
const p = spawnSync(process.execPath, [path.resolve('../../herramientas/verificar-seguridad.mjs'), d], { encoding: 'utf8' });
t('por línea de comandos: sale con error y no muestra la clave', p.status === 1 && /CRÍTICO/.test(p.stdout) && !p.stdout.includes(SERVICIO.split('.')[1]), p.stdout + p.stderr);
const l = spawnSync(process.execPath, [path.resolve('../../herramientas/verificar-seguridad.mjs'), proyecto({})], { encoding: 'utf8' });
t('por línea de comandos: proyecto limpio sale bien', l.status === 0 && /Sin hallazgos/.test(l.stdout), l.stdout + l.stderr);

console.log(`\n${mal === 0 ? '✔' : '✘'} ${ok} correctas, ${mal} con fallo`);
process.exit(mal ? 1 : 0);
