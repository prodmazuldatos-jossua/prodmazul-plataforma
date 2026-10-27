#!/usr/bin/env node
// Prodmazul · Restauración de FOTOS desde la copia de Google Drive.
//
// Uso:  node herramientas/restaurar-fotos.mjs --fotos-meta <fotos_meta.csv> --carpeta <carpeta M01_Recepcion descargada de Drive>
//                                              [--url <https://….supabase.co>] [--salida fotos_restauradas.sql] [--simular]
// La clave de administración de Supabase se lee de la variable de entorno SUPABASE_SERVICE_ROLE_KEY (NUNCA como argumento,
// NUNCA en un archivo). La dirección puede ir en --url o en la variable SUPABASE_URL.
// Qué hace: busca en la carpeta descargada los archivos «.../REC-AAAAMMDD-NNNN/foto_NN.jpg|png|webp», los empareja con la
// hoja fotos_meta y los sube al almacenamiento (bucket privado) en la ruta que la aplicación espera. No pisa fotos que ya estén.
// Con --simular solo cuenta lo que haría. No imprime la clave, ni la dirección completa, ni el contenido de las fotos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tablaCsv } from './csv.mjs';

export const BUCKET = 'm01-recepcion-fotos';
const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Recorre la carpeta y devuelve [{ recepcion_id, nn, archivo }] de los archivos «foto_NN.ext» dentro de carpetas REC-… */
export function buscarArchivos(raiz) {
  const res = [];
  const visitar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { visitar(p); continue; }
      const m = /^foto_(\d{2})\.(jpe?g|png|webp)$/i.exec(e.name);
      const rec = path.basename(dir);
      if (m && /^REC-\d{8}-\d{4,}$/.test(rec)) res.push({ recepcion_id: rec, nn: Number(m[1]), archivo: p, ext: m[2].toLowerCase() });
    }
  };
  visitar(raiz);
  return res;
}

export function coincideFormato(bytes, mime) {
  const b = (i) => bytes[i];
  if (mime === 'image/jpeg') return bytes.length > 3 && b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF;
  if (mime === 'image/png') return bytes.length > 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47;
  if (mime === 'image/webp') return bytes.length > 12 && b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50;
  return false;
}

/** Empareja la hoja fotos_meta con los archivos. Devuelve { listas, sinArchivo, huerfanos }. */
export function emparejar(filas, archivos) {
  const porClave = new Map(archivos.map((a) => [`${a.recepcion_id}#${a.nn}`, a]));
  const usados = new Set();
  const listas = [], sinArchivo = [];
  for (const f of filas) {
    const clave = `${f.recepcion_id}#${Number(f.nn)}`;
    const a = porClave.get(clave);
    if (!a) { sinArchivo.push(f.foto_id); continue; }
    usados.add(clave);
    listas.push({ foto: f, archivo: a });
  }
  return { listas, sinArchivo, huerfanos: archivos.filter((a) => !usados.has(`${a.recepcion_id}#${a.nn}`)).length };
}

export async function subir(base, clave, ruta, bytes, mime, f = fetch) {
  const url = `${base.replace(/\/+$/, '')}/storage/v1/object/${BUCKET}/${ruta.split('/').map(encodeURIComponent).join('/')}`;
  const r = await f(url, { method: 'POST', headers: { Authorization: `Bearer ${clave}`, apikey: clave, 'Content-Type': mime, 'x-upsert': 'false', 'cache-control': '3600' }, body: bytes });
  if (r.ok) return 'subida';
  const t = await r.text().catch(() => '');
  if (r.status === 409 || /already exists|Duplicate/i.test(t)) return 'ya_estaba';
  return `error ${r.status}`;
}

export function sqlMarcar(ids) {
  if (ids.length === 0) return '-- No hay fotos que marcar.\n';
  const lista = ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(', ');
  return `-- Las fotos restauradas vuelven a estar en Supabase: se quita la marca de «purgada».\nupdate m01_recepcion.fotos_meta set purgada_supabase_en = null where foto_id in (${lista}) and purgada_supabase_en is not null;\n`;
}

export async function restaurar(opc, entorno = process.env, f = fetch, salidaLog = console.log) {
  const filas = tablaCsv(fs.readFileSync(opc.fotosMeta, 'utf8')).filas.filter((x) => x.foto_id && x.recepcion_id && x.ruta);
  const { listas, sinArchivo, huerfanos } = emparejar(filas, buscarArchivos(opc.carpeta));
  const r = { en_la_hoja: filas.length, con_archivo: listas.length, sin_archivo: sinArchivo.length, sin_hoja: huerfanos, subidas: 0, ya_estaban: 0, errores: 0, tamano_distinto: 0, formato_invalido: 0 };
  const marcar = [];
  const clave = entorno.SUPABASE_SERVICE_ROLE_KEY;
  const base = opc.url || entorno.SUPABASE_URL;
  if (!opc.simular && (!clave || !base)) throw new Error('Falta la dirección (--url o SUPABASE_URL) o la variable SUPABASE_SERVICE_ROLE_KEY. Use --simular para solo contar.');
  for (const { foto, archivo } of listas) {
    const bytes = fs.readFileSync(archivo.archivo);
    const mime = foto.tipo_mime || EXT_MIME[archivo.ext];
    if (foto.tamano_bytes && Number(foto.tamano_bytes) !== bytes.length) { r.tamano_distinto++; continue; }
    if (!coincideFormato(bytes, mime)) { r.formato_invalido++; continue; }
    if (opc.simular) { r.subidas++; marcar.push(foto.foto_id); continue; }
    const res = await subir(base, clave, foto.ruta, bytes, mime, f);
    if (res === 'subida') { r.subidas++; marcar.push(foto.foto_id); }
    else if (res === 'ya_estaba') { r.ya_estaban++; marcar.push(foto.foto_id); }
    else r.errores++;
  }
  return { resumen: r, sinArchivo, sql: sqlMarcar(marcar) };
}

async function principal(argv) {
  const a = { fotosMeta: null, carpeta: null, url: null, salida: 'fotos_restauradas.sql', simular: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fotos-meta') a.fotosMeta = argv[++i];
    else if (argv[i] === '--carpeta') a.carpeta = argv[++i];
    else if (argv[i] === '--url') a.url = argv[++i];
    else if (argv[i] === '--salida') a.salida = argv[++i];
    else if (argv[i] === '--simular') a.simular = true;
    else { console.error(`Opción desconocida: ${argv[i]}`); return 2; }
  }
  if (!a.fotosMeta || !fs.existsSync(a.fotosMeta) || !a.carpeta || !fs.existsSync(a.carpeta)) { console.error('Indica --fotos-meta <archivo.csv> y --carpeta <carpeta de Drive>.'); return 2; }
  try {
    const { resumen: r, sinArchivo, sql } = await restaurar(a);
    fs.writeFileSync(a.salida, sql, 'utf8');
    console.log(`\nRestauración de fotos${a.simular ? ' (SIMULACIÓN: no se subió nada)' : ''}`);
    console.log(`  Fotos en la hoja fotos_meta:      ${r.en_la_hoja}`);
    console.log(`  Con archivo en la carpeta:        ${r.con_archivo}`);
    console.log(`  ${a.simular ? 'Se subirían' : 'Subidas'}:                        ${r.subidas}`);
    console.log(`  Ya estaban en Supabase:           ${r.ya_estaban}`);
    console.log(`  Sin archivo en la carpeta:        ${r.sin_archivo}${sinArchivo.length ? ' (' + sinArchivo.slice(0, 5).join(', ') + (sinArchivo.length > 5 ? ', …' : '') + ')' : ''}`);
    console.log(`  Archivos sin fila en la hoja:     ${r.sin_hoja}`);
    console.log(`  Tamaño distinto (no se subieron): ${r.tamano_distinto}`);
    console.log(`  Formato inválido (no se subieron): ${r.formato_invalido}`);
    console.log(`  Errores al subir:                 ${r.errores}`);
    console.log(`\nSe escribió ${a.salida}: ejecútalo en la base para quitar la marca de «purgada» a las fotos restauradas.`);
    return r.errores > 0 ? 1 : 0;
  } catch (e) { console.error(String(e.message).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[clave]')); return 2; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await principal(process.argv.slice(2)));
