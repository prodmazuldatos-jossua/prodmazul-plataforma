// Pruebas de las herramientas de restauración (sin base de datos ni internet).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { leerCsv, tablaCsv } from '../../herramientas/csv.mjs';
import { TABLAS, archivoDeHoja, construirSql } from '../../herramientas/restaurar-desde-sheets.mjs';
import { buscarArchivos, coincideFormato, emparejar, restaurar, sqlMarcar, subir } from '../../herramientas/restaurar-fotos.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const herr = path.resolve(aqui, '../../herramientas');
let ok = 0, mal = 0;
const prueba = async (n, f) => { try { await f(); ok++; console.log('  ✔', n); } catch (e) { mal++; console.log('  ✘', n, '\n     ', e.message); } };
const igual = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} esperado ${JSON.stringify(b)} y fue ${JSON.stringify(a)}`); };
const cierto = (c, m) => { if (!c) throw new Error(m); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prodmazul-rest-'));

console.log('\nLector de CSV');
await prueba('comillas, comas, saltos de línea y comillas dobles dentro de una celda', () => {
  const f = leerCsv('a,b,c\r\n"x, y","línea 1\nlínea 2","di ""hola"""\r\n');
  igual(f, [['a', 'b', 'c'], ['x, y', 'línea 1\nlínea 2', 'di "hola"']]);
});
await prueba('quita el BOM y acepta CRLF, LF y sin salto final', () => igual(leerCsv('﻿a,b\n1,2'), [['a', 'b'], ['1', '2']]));
await prueba('celdas vacías se conservan', () => igual(leerCsv('a,b,c\n,,\n'), [['a', 'b', 'c'], ['', '', '']]));
await prueba('tablaCsv devuelve objetos y descarta filas totalmente vacías', () => {
  const t = tablaCsv('id,nombre\n1,Ana\n,\n2,Luis\n');
  igual(t.columnas, ['id', 'nombre']); igual(t.filas.length, 2); igual(t.filas[1].nombre, 'Luis');
});
await prueba('un CSV vacío no rompe', () => igual(tablaCsv('').columnas, []));

console.log('\nNombres de archivo de Google Sheets');
await prueba('reconoce «hoja.csv» y «Libro - hoja.csv»', () => {
  const a = ['Libro 2026 - recepciones.csv', 'Libro 2026 - recepcion_gavetas.csv', 'lotes.csv', 'otro.txt'];
  igual(archivoDeHoja(a, 'recepciones'), 'Libro 2026 - recepciones.csv');
  igual(archivoDeHoja(a, 'recepcion_gavetas'), 'Libro 2026 - recepcion_gavetas.csv');
  igual(archivoDeHoja(a, 'lotes'), 'lotes.csv');
  igual(archivoDeHoja(a, 'especies'), null);
});
await prueba('«recepciones» no se confunde con «recepcion_gavetas»', () => igual(archivoDeHoja(['x - recepcion_gavetas.csv'], 'recepciones'), null));

console.log('\nGeneración del SQL');
const base = { proveedores: 'id,nombre,nombre_normalizado\r\np1,Sol,SOL\r\n', recepciones: 'recepcion_id,guia_remision,realizado_por\r\nREC-20261026-0001,G1,u1\r\n', perfiles: 'user_id,nombre\r\nu1,Ana\r\n', config: 'clave,valor\r\nmax,5\r\n' };
await prueba('por defecto omite usuarios y configuración y lo dice', () => {
  const { sql, resumen } = construirSql(base);
  cierto(!sql.includes("'core.perfiles'") && !sql.includes("'core.config'"), 'no debe incluir perfiles ni config');
  cierto(resumen.find((r) => r.hoja === 'perfiles').omitida && resumen.find((r) => r.hoja === 'config').omitida, 'deben figurar como omitidas');
});
await prueba('con las opciones incluye usuarios (solo si hay cuenta) y configuración (se actualiza)', () => {
  const { sql } = construirSql(base, { incluirUsuarios: true, incluirConfig: true });
  cierto(sql.includes("'core.perfiles'") && sql.includes("'core.config'"), 'faltan');
  cierto(/'core\.perfiles'[^;]*array\[\][^;]*, true, array\[\]::text\[\], true\)/.test(sql.replace(/\n/g, ' ')) || sql.includes("true, array[]::text[], true"), 'perfiles debe actualizar y exigir cuenta');
});
await prueba('las hojas que faltan se avisan y no rompen', () => {
  const { resumen } = construirSql({ proveedores: base.proveedores });
  cierto(resumen.find((r) => r.hoja === 'especies').motivo === 'no se encontró el CSV', 'debe avisar');
});
await prueba('termina en transacción, con resumen y sin borrar nada', () => {
  const { sql } = construirSql(base);
  cierto(sql.startsWith('--') && sql.includes('begin;') && sql.trim().endsWith('commit;'), 'transacción');
  cierto(!/\b(delete|drop|truncate)\b/i.test(sql.replace(/create function[\s\S]*?end \$f\$;/g, '').replace(/on commit drop/g, '')), 'no debe borrar');
  cierto(sql.includes('on conflict'), 'solo agrega');
});
await prueba('reconstruye los contadores solo si hay recepciones', () => {
  cierto(construirSql(base).sql.includes('m01_recepcion.contadores'), 'con recepciones');
  cierto(!construirSql({ proveedores: base.proveedores }).sql.includes('m01_recepcion.contadores'), 'sin recepciones');
});
await prueba('los datos con apóstrofes, $ y etiquetas parecidas no rompen el SQL', () => {
  const raro = "id,nombre\r\np1,\"O'Brien $d1234abcd$ ; drop table x; --\"\r\n";
  const { sql } = construirSql({ proveedores: raro });
  const tags = [...sql.matchAll(/\$d[0-9a-f]{8}\$/g)].map((m) => m[0]);
  cierto(tags.length >= 2 && tags[0] === tags[tags.length - 1] || tags.length >= 2, 'usa etiqueta propia');
  const etiqueta = sql.match(/'core\.proveedores', (\$d[0-9a-f]{8}\$)/)[1];
  cierto(etiqueta !== '$d1234abcd$', 'la etiqueta no puede aparecer dentro de los datos');
});
await prueba('más de 400 filas se reparten en tandas', () => {
  const filas = Array.from({ length: 950 }, (_, i) => `p${i},N${i},N${i}`).join('\r\n');
  const { sql } = construirSql({ proveedores: `id,nombre,nombre_normalizado\r\n${filas}\r\n` });
  igual((sql.match(/perform pg_temp\.restaurar_tabla\('core\.proveedores'/g) || []).length, 3);
});
await prueba('el nombre de una columna con apóstrofe se escapa', () => {
  const { sql } = construirSql({ proveedores: "id,na'me\r\n1,2\r\n" });
  cierto(sql.includes("'na''me'"), 'escape');
});

console.log('\nLínea de comandos de Sheets');
await prueba('escribe el SQL y no imprime el contenido de las celdas', () => {
  const d = tmp(); const sal = path.join(d, 'r.sql');
  fs.writeFileSync(path.join(d, 'Libro 2026 - proveedores.csv'), 'id,nombre,nombre_normalizado\r\np1,SECRETO-VISIBLE-123,X\r\n');
  const out = execFileSync(process.execPath, [path.join(herr, 'restaurar-desde-sheets.mjs'), '--carpeta', d, '--salida', sal], { encoding: 'utf8' });
  cierto(fs.existsSync(sal) && fs.readFileSync(sal, 'utf8').includes('SECRETO-VISIBLE-123'), 'el SQL sí lleva los datos');
  cierto(!out.includes('SECRETO-VISIBLE-123') && out.includes('1 fila(s)'), 'la pantalla solo muestra cantidades');
});
await prueba('sin --carpeta o con una opción rara sale con error claro', () => {
  const a = spawnSync(process.execPath, [path.join(herr, 'restaurar-desde-sheets.mjs')], { encoding: 'utf8' });
  const b = spawnSync(process.execPath, [path.join(herr, 'restaurar-desde-sheets.mjs'), '--cosa'], { encoding: 'utf8' });
  cierto(a.status === 2 && /--carpeta/.test(a.stderr) && b.status === 2, 'códigos de salida');
});
await prueba('cubre las 11 hojas del exportador', () => igual(TABLAS.map((t) => t.hoja), ['proveedores', 'especies', 'lotes', 'perfiles', 'usuario_modulo_rol', 'config', 'recepciones', 'recepcion_gavetas', 'recepcion_temperaturas', 'recepcion_almacenamiento', 'fotos_meta']));

console.log('\nFotos desde Drive');
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(96, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(72, 2)]);
function carpetaDrive() {
  const d = tmp();
  const r1 = path.join(d, '2026', '10', 'REC-20261026-0001'); fs.mkdirSync(r1, { recursive: true });
  fs.writeFileSync(path.join(r1, 'foto_01.jpg'), JPG); fs.writeFileSync(path.join(r1, 'foto_02.png'), PNG);
  fs.writeFileSync(path.join(r1, 'foto_01_anterior_20261026101010.jpg'), JPG);
  const otra = path.join(d, '2026', '10', 'carpeta-rara'); fs.mkdirSync(otra, { recursive: true }); fs.writeFileSync(path.join(otra, 'foto_01.jpg'), JPG);
  return d;
}
function hoja(extra = '') {
  const d = tmp(); const p = path.join(d, 'fotos_meta.csv');
  fs.writeFileSync(p, 'foto_id,recepcion_id,nn,ruta,tipo_mime,tamano_bytes\r\n' +
    'F1,REC-20261026-0001,1,M01/961/REC-20261026-0001/a1.jpg,image/jpeg,100\r\n' +
    'F2,REC-20261026-0001,2,M01/961/REC-20261026-0001/a2.png,image/png,81\r\n' +
    'F3,REC-20261026-0001,3,M01/961/REC-20261026-0001/a3.jpg,image/jpeg,100\r\n' + extra);
  return p;
}
await prueba('encuentra solo «foto_NN.ext» dentro de carpetas REC-… (ignora anteriores y carpetas ajenas)', () => {
  const a = buscarArchivos(carpetaDrive());
  igual(a.map((x) => `${x.recepcion_id}#${x.nn}`).sort(), ['REC-20261026-0001#1', 'REC-20261026-0001#2']);
});
await prueba('reconoce el formato por los primeros bytes', () => {
  cierto(coincideFormato(JPG, 'image/jpeg') && coincideFormato(PNG, 'image/png'), 'válidos');
  cierto(!coincideFormato(JPG, 'image/png') && !coincideFormato(Buffer.from('hola'), 'image/jpeg'), 'inválidos');
});
await prueba('empareja con la hoja y cuenta lo que falta', () => {
  const e = emparejar([{ foto_id: 'F1', recepcion_id: 'REC-20261026-0001', nn: '1' }, { foto_id: 'F9', recepcion_id: 'REC-20261026-0009', nn: '1' }], buscarArchivos(carpetaDrive()));
  igual(e.listas.length, 1); igual(e.sinArchivo, ['F9']); igual(e.huerfanos, 1);
});
const falso = (estado, cuerpo = '') => { const llamadas = []; const f = async (url, opt) => { llamadas.push({ url, opt }); return { ok: estado === 200, status: estado, text: async () => cuerpo }; }; f.llamadas = llamadas; return f; };
await prueba('subir: 200 = subida, 409 = ya estaba, otro = error; la ruta se codifica y no duplica', async () => {
  const f = falso(200); igual(await subir('https://x.supabase.co/', 'CLAVE', 'M01/a b/c.jpg', JPG, 'image/jpeg', f), 'subida');
  cierto(f.llamadas[0].url === 'https://x.supabase.co/storage/v1/object/m01-recepcion-fotos/M01/a%20b/c.jpg', 'url');
  igual(f.llamadas[0].opt.headers['x-upsert'], 'false');
  igual(await subir('https://x', 'k', 'r', JPG, 'image/jpeg', falso(409)), 'ya_estaba');
  igual(await subir('https://x', 'k', 'r', JPG, 'image/jpeg', falso(400, '{"error":"Duplicate"}')), 'ya_estaba');
  igual(await subir('https://x', 'k', 'r', JPG, 'image/jpeg', falso(500)), 'error 500');
});
await prueba('restaurar: sube 1 con tamaño correcto, salta la de tamaño distinto y marca las restauradas', async () => {
  const f = falso(200);
  const r = await restaurar({ fotosMeta: hoja(), carpeta: carpetaDrive(), url: 'https://x.supabase.co', simular: false }, { SUPABASE_SERVICE_ROLE_KEY: 'CLAVE-DE-PRUEBA' }, f);
  igual([r.resumen.en_la_hoja, r.resumen.con_archivo, r.resumen.subidas, r.resumen.sin_archivo, r.resumen.tamano_distinto], [3, 2, 1, 1, 1], 'conteos');
  cierto(f.llamadas.length === 1, 'solo una subida');
  cierto(r.sql.includes("'F1'") && !r.sql.includes("'F2'") && !r.sql.includes("'F3'"), 'solo marca la restaurada');
  cierto(!JSON.stringify(r).includes('CLAVE-DE-PRUEBA'), 'el resultado no contiene la clave');
});
await prueba('restaurar: sin clave o sin dirección falla (salvo --simular), y simular no llama a nadie', async () => {
  let msg = ''; try { await restaurar({ fotosMeta: hoja(), carpeta: carpetaDrive(), simular: false }, {}, falso(200)); } catch (e) { msg = e.message; }
  cierto(/SUPABASE_SERVICE_ROLE_KEY/.test(msg), 'debe pedir la variable');
  const f = falso(200); const r = await restaurar({ fotosMeta: hoja(), carpeta: carpetaDrive(), simular: true }, {}, f);
  cierto(f.llamadas.length === 0 && r.resumen.subidas === 1, 'simulación');
});
await prueba('restaurar: error del servidor se cuenta y no marca la foto', async () => {
  const r = await restaurar({ fotosMeta: hoja(), carpeta: carpetaDrive(), url: 'https://x', simular: false }, { SUPABASE_SERVICE_ROLE_KEY: 'k' }, falso(500));
  igual(r.resumen.errores, 1); cierto(!r.sql.includes("'F1'"), 'no marcar');
});
await prueba('un archivo que no es imagen no se sube', async () => {
  const d = carpetaDrive(); fs.writeFileSync(path.join(d, '2026', '10', 'REC-20261026-0001', 'foto_01.jpg'), Buffer.alloc(100, 7));
  const f = falso(200);
  const r = await restaurar({ fotosMeta: hoja(), carpeta: d, url: 'https://x', simular: false }, { SUPABASE_SERVICE_ROLE_KEY: 'k' }, f);
  igual(r.resumen.formato_invalido, 1); igual(f.llamadas.length, 0);
});
await prueba('sqlMarcar escapa apóstrofes y no hace nada sin fotos', () => {
  cierto(sqlMarcar(["a'b"]).includes("'a''b'"), 'escape'); cierto(!/update/.test(sqlMarcar([])), 'vacío');
});
await prueba('la línea de comandos no imprime la clave ni la dirección', () => {
  const d = carpetaDrive(); const sal = path.join(tmp(), 'f.sql');
  const r = spawnSync(process.execPath, [path.join(herr, 'restaurar-fotos.mjs'), '--fotos-meta', hoja(), '--carpeta', d, '--simular', '--salida', sal], { encoding: 'utf8', env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: 'CLAVE-SECRETA-XYZ', SUPABASE_URL: 'https://proyecto-secreto.supabase.co' } });
  cierto(r.status === 0 && /SIMULACIÓN/.test(r.stdout), 'sale bien: ' + r.stderr);
  cierto(!(r.stdout + r.stderr).includes('CLAVE-SECRETA-XYZ') && !(r.stdout + r.stderr).includes('proyecto-secreto'), 'no imprime secretos');
  cierto(fs.existsSync(sal), 'escribe el SQL');
});

console.log(`\n${mal === 0 ? '✔' : '✘'} ${ok} correctas, ${mal} con fallo`);
process.exit(mal ? 1 : 0);
