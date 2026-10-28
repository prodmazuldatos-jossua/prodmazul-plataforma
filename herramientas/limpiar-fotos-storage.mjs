#!/usr/bin/env node
// Prodmazul · Limpieza de las FOTOS guardadas en Supabase Storage (para empezar en producción).
//
// Uso:  node herramientas/limpiar-fotos-storage.mjs [--url <https://….supabase.co>] [--confirmo]
// Sin --confirmo solo CUENTA los archivos (simulación). Con --confirmo los BORRA, de forma definitiva.
// Solo toca el bucket privado «m01-recepcion-fotos». La clave de administración se lee de la variable de entorno
// SUPABASE_SERVICE_ROLE_KEY (NUNCA como argumento ni en un archivo); la dirección, de --url o de SUPABASE_URL.
// No imprime la clave, la dirección completa ni los nombres de los archivos (solo cantidades).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUCKET = 'm01-recepcion-fotos';
const POR_PAGINA = 100;
const POR_LOTE_BORRADO = 100;

function cabeceras(clave) {
  return { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' };
}

/** Lista TODAS las rutas de archivos del bucket (recorre las carpetas). */
export async function listarRutas(base, clave, f = fetch) {
  const rutas = [];
  const pendientes = [''];
  while (pendientes.length) {
    const prefijo = pendientes.pop();
    for (let offset = 0; ; offset += POR_PAGINA) {
      const r = await f(`${base.replace(/\/$/, '')}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST', headers: cabeceras(clave),
        body: JSON.stringify({ prefix: prefijo, limit: POR_PAGINA, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!r.ok) throw new Error(`No se pudo listar el almacenamiento (código ${r.status}).`);
      const items = await r.json();
      for (const it of items) {
        const ruta = prefijo ? `${prefijo}/${it.name}` : it.name;
        if (it.id === null || it.id === undefined) pendientes.push(ruta); // carpeta
        else rutas.push(ruta);
      }
      if (items.length < POR_PAGINA) break;
    }
  }
  return rutas;
}

export async function borrarRutas(base, clave, rutas, f = fetch) {
  let borradas = 0;
  for (let i = 0; i < rutas.length; i += POR_LOTE_BORRADO) {
    const lote = rutas.slice(i, i + POR_LOTE_BORRADO);
    const r = await f(`${base.replace(/\/$/, '')}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: cabeceras(clave), body: JSON.stringify({ prefixes: lote }) });
    if (!r.ok) throw new Error(`No se pudo borrar un grupo de archivos (código ${r.status}). Se borraron ${borradas} antes de fallar; puedes repetir el comando.`);
    borradas += lote.length;
  }
  return borradas;
}

export async function limpiar(opc, entorno = process.env, f = fetch) {
  const clave = entorno.SUPABASE_SERVICE_ROLE_KEY;
  const base = opc.url || entorno.SUPABASE_URL;
  if (!clave || !base) throw new Error('Falta la dirección (--url o SUPABASE_URL) o la variable SUPABASE_SERVICE_ROLE_KEY.');
  const rutas = await listarRutas(base, clave, f);
  if (!opc.confirmo) return { encontradas: rutas.length, borradas: 0, simulacion: true, restantes: rutas.length };
  const borradas = await borrarRutas(base, clave, rutas, f);
  const restantes = (await listarRutas(base, clave, f)).length;
  return { encontradas: rutas.length, borradas, simulacion: false, restantes };
}

async function principal(argv) {
  const a = { url: null, confirmo: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url') a.url = argv[++i];
    else if (argv[i] === '--confirmo') a.confirmo = true;
    else { console.error(`Opción desconocida: ${argv[i]}`); return 2; }
  }
  try {
    const r = await limpiar(a);
    console.log(`\nLimpieza de fotos en Supabase Storage${r.simulacion ? ' (SIMULACIÓN: no se borró nada)' : ''}`);
    console.log(`  Archivos encontrados:  ${r.encontradas}`);
    console.log(`  Archivos borrados:     ${r.borradas}`);
    console.log(`  Archivos que quedan:   ${r.restantes}`);
    if (r.simulacion) console.log('\nPara borrarlos de verdad, repite el comando agregando --confirmo.');
    return r.simulacion || r.restantes === 0 ? 0 : 1;
  } catch (e) { console.error(String(e.message).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[clave]')); return 2; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await principal(process.argv.slice(2)));
