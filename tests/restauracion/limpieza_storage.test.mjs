// Pruebas de herramientas/limpiar-fotos-storage.mjs con un almacenamiento simulado (sin internet).
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BUCKET, limpiar, listarRutas } from '../../herramientas/limpiar-fotos-storage.mjs';

let ok = 0, mal = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('  ✔', n); } else { mal++; console.log('  ✘', n, x); } };
const CLAVE = 'clave-falsa-solo-para-pruebas-0123456789';

/** Almacenamiento simulado: árbol de carpetas con paginación de 100 y borrado por lotes. */
function simulado(rutas) {
  const archivos = new Set(rutas); const llamadas = [];
  const f = async (url, opc) => {
    llamadas.push({ url, metodo: opc.method, auth: opc.headers.Authorization });
    if (!url.includes(`/${BUCKET}`)) return { ok: false, status: 404, json: async () => ({}) };
    if (opc.method === 'POST') {
      const { prefix, limit, offset } = JSON.parse(opc.body);
      const base = prefix ? prefix + '/' : '';
      const hijos = new Map();
      for (const r of archivos) if (r.startsWith(base)) { const resto = r.slice(base.length); const [n, ...mas] = resto.split('/'); hijos.set(n, mas.length ? null : r); }
      const lista = [...hijos.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, id]) => ({ name, id }));
      return { ok: true, status: 200, json: async () => lista.slice(offset, offset + limit) };
    }
    if (opc.method === 'DELETE') { for (const p of JSON.parse(opc.body).prefixes) archivos.delete(p); return { ok: true, status: 200, json: async () => [] }; }
    return { ok: false, status: 405, json: async () => ({}) };
  };
  return { f, archivos, llamadas };
}
const rutas = []; for (let i = 1; i <= 250; i++) rutas.push(`M01/2026/10/REC-20261026-${String(i).padStart(4, '0')}/foto_01.jpg`);
rutas.push('M01/2026/10/REC-20261026-0001/foto_02.png', 'suelto.jpg');

console.log('\nLimpieza de fotos en Supabase Storage');
{
  const s = simulado(rutas);
  const lista = await listarRutas('https://x.supabase.co', CLAVE, s.f);
  t('encuentra todos los archivos, también en carpetas y con más de 100 por página', lista.length === 252, String(lista.length));
}
{
  const s = simulado(rutas);
  const r = await limpiar({ url: 'https://x.supabase.co' }, { SUPABASE_SERVICE_ROLE_KEY: CLAVE }, s.f);
  t('sin --confirmo es simulación: cuenta y no borra', r.simulacion === true && r.encontradas === 252 && r.borradas === 0 && s.archivos.size === 252 && !s.llamadas.some((l) => l.metodo === 'DELETE'));
}
{
  const s = simulado(rutas);
  const r = await limpiar({ url: 'https://x.supabase.co', confirmo: true }, { SUPABASE_SERVICE_ROLE_KEY: CLAVE }, s.f);
  t('con --confirmo borra todo y comprueba que no queda nada', r.borradas === 252 && r.restantes === 0 && s.archivos.size === 0, JSON.stringify(r));
  t('solo habla con el bucket de fotos de Recepción', s.llamadas.every((l) => l.url.includes('/storage/v1/object/') && l.url.includes(BUCKET)));
  t('usa la clave de la variable de entorno', s.llamadas.every((l) => l.auth === `Bearer ${CLAVE}`));
}
{
  let error = null; try { await limpiar({ confirmo: true }, {}, async () => ({})); } catch (e) { error = e.message; }
  t('sin clave o sin dirección se detiene', /Falta la dirección/.test(error ?? ''));
  const s = simulado(rutas); s.f2 = async (u, o) => (o.method === 'DELETE' ? { ok: false, status: 500, json: async () => ({}) } : s.f(u, o));
  let e2 = null; try { await limpiar({ url: 'https://x.supabase.co', confirmo: true }, { SUPABASE_SERVICE_ROLE_KEY: CLAVE }, s.f2); } catch (e) { e2 = e.message; }
  t('si el borrado falla, avisa sin mostrar la clave', /No se pudo borrar/.test(e2 ?? '') && !(e2 ?? '').includes(CLAVE));
}
{
  const herr = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../herramientas/limpiar-fotos-storage.mjs');
  const r = spawnSync('node', [herr], { env: { PATH: process.env.PATH, SUPABASE_SERVICE_ROLE_KEY: CLAVE, SUPABASE_URL: 'http://127.0.0.1:9' }, encoding: 'utf8' });
  t('la línea de comandos no imprime la clave ni la dirección', !(r.stdout + r.stderr).includes(CLAVE) && !(r.stdout + r.stderr).includes('127.0.0.1'), r.stderr);
  const r2 = spawnSync('node', [herr, '--raro'], { encoding: 'utf8' });
  t('opción desconocida: error', r2.status === 2);
}
console.log(`\n${mal === 0 ? '✔' : '✘'} ${ok} correctas, ${mal} con fallo`);
process.exit(mal ? 1 : 0);
