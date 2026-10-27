#!/usr/bin/env node
// Prodmazul · Restauración de datos desde la copia de Google Sheets.
//
// Uso:  node herramientas/restaurar-desde-sheets.mjs --carpeta <carpeta con los CSV> [--salida restauracion.sql]
//                                                     [--incluir-usuarios] [--incluir-config]
// Qué hace: lee los CSV que descargaste de cada pestaña del libro (Archivo > Descargar > CSV) y escribe un archivo SQL.
// NO se conecta a ninguna base de datos y NO imprime el contenido de las celdas (solo cantidades).
// El SQL solo AGREGA lo que falta (on conflict do nothing): no pisa ni borra nada de lo que ya exista.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tablaCsv } from './csv.mjs';

// Mismo orden que core.sync_tablas. «actualizar»: si ya existe, se actualiza (perfiles y configuración).
export const TABLAS = [
  { tabla: 'core.proveedores', hoja: 'proveedores' },
  { tabla: 'core.especies', hoja: 'especies' },
  { tabla: 'core.lotes', hoja: 'lotes' },
  { tabla: 'core.perfiles', hoja: 'perfiles', usuarios: true, actualizar: true, requiereAuth: true },
  { tabla: 'core.usuario_modulo_rol', hoja: 'usuario_modulo_rol', usuarios: true, requiereAuth: true },
  { tabla: 'core.config', hoja: 'config', config: true, actualizar: true },
  { tabla: 'm01_recepcion.recepciones', hoja: 'recepciones', fkPerfil: ['realizado_por', 'revisado_por'] },
  { tabla: 'm01_recepcion.recepcion_gavetas', hoja: 'recepcion_gavetas' },
  { tabla: 'm01_recepcion.recepcion_temperaturas', hoja: 'recepcion_temperaturas' },
  { tabla: 'm01_recepcion.recepcion_almacenamiento', hoja: 'recepcion_almacenamiento' },
  { tabla: 'm01_recepcion.fotos_meta', hoja: 'fotos_meta' },
];
const TAMANO_TANDA = 400;

/** Encuentra el CSV de una pestaña: «hoja.csv» o «Libro - hoja.csv» (como lo nombra Google Sheets). */
export function archivoDeHoja(archivos, hoja) {
  const h = hoja.toLowerCase();
  return archivos.find((a) => { const n = a.replace(/\.csv$/i, '').toLowerCase(); return n === h || n.endsWith(' - ' + h) || n.endsWith('-' + h); }) ?? null;
}

const AUX = `-- Las celdas con JSON llegan como texto; un texto que no es JSON (p. ej. un formato de lote) se guarda como texto JSON.
create or replace function pg_temp.a_jsonb(p text) returns jsonb language plpgsql as $f$
begin
  if p is null or p = '' then return null; end if;
  if p in ('TRUE', 'FALSE') then return to_jsonb(p = 'TRUE'); end if;  -- Sheets escribe los sí/no en mayúsculas
  begin return p::jsonb; exception when others then return to_jsonb(p); end;
end $f$;`;

const FUNCION = `create or replace function pg_temp.restaurar_tabla(p_tabla text, p_datos jsonb, p_hdr text[], p_actualizar boolean, p_fk_perfil text[], p_requiere_auth boolean)
returns void language plpgsql as $f$
declare
  v_oid  oid := p_tabla::regclass::oid;
  v_cols text; v_sel text; v_pk text; v_set text; v_conf text; v_where text := ''; v_n bigint;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
         string_agg(case
           when a.attname = any(p_fk_perfil) then
             format('case when nullif(e ->> %L, %L) in (select user_id::text from core.perfiles) then (e ->> %L)::uuid end', a.attname, '', a.attname)
           when t.typname = 'jsonb' then format('pg_temp.a_jsonb(e ->> %L)', a.attname)
           when t.typname in ('text', 'varchar', 'bpchar') then
             case when a.attnotnull then format('coalesce(e ->> %L, %L)', a.attname, '') else format('nullif(e ->> %L, %L)', a.attname, '') end
           else format('nullif(e ->> %L, %L)::%s', a.attname, '', format_type(a.atttypid, a.atttypmod)) end,
         ', ' order by a.attnum)
    into v_cols, v_sel
  from pg_attribute a join pg_type t on t.oid = a.atttypid
  where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attname = any(p_hdr);
  if v_cols is null then raise exception 'La hoja de % no tiene ninguna columna conocida.', p_tabla; end if;
  select string_agg(quote_ident(a.attname), ', ') into v_pk
  from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = v_oid and i.indisprimary;
  if p_requiere_auth then v_where := ' where nullif(e ->> ''user_id'', '''') in (select id::text from auth.users)'; end if;
  v_conf := 'do nothing';
  if p_actualizar then
    select string_agg(format('%1$s = excluded.%1$s', quote_ident(a.attname)), ', ') into v_set
    from pg_attribute a where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attname = any(p_hdr)
      and not exists (select 1 from pg_index i where i.indrelid = v_oid and i.indisprimary and a.attnum = any(i.indkey));
    if v_set is not null then v_conf := format('(%s) do update set %s', v_pk, v_set); end if;
  end if;
  execute format('insert into %s (%s) select %s from jsonb_array_elements($1) e%s on conflict %s', p_tabla, v_cols, v_sel, v_where, v_conf) using p_datos;
  get diagnostics v_n = row_count;
  insert into pg_temp._restauracion values (p_tabla, jsonb_array_length(p_datos), v_n);
end $f$;`;

/** Construye el SQL. archivos: { hoja: textoCsv }. Devuelve { sql, resumen: [{hoja, filas, omitida?, motivo?}] }. */
export function construirSql(archivos, opc = {}) {
  const resumen = [];
  const bloques = [];
  for (const t of TABLAS) {
    if (t.usuarios && !opc.incluirUsuarios) { resumen.push({ hoja: t.hoja, filas: 0, omitida: true, motivo: 'usuarios: use --incluir-usuarios (solo si las cuentas ya existen en Authentication)' }); continue; }
    if (t.config && !opc.incluirConfig) { resumen.push({ hoja: t.hoja, filas: 0, omitida: true, motivo: 'configuración: use --incluir-config para actualizar los parámetros' }); continue; }
    const texto = archivos[t.hoja];
    if (texto === undefined) { resumen.push({ hoja: t.hoja, filas: 0, omitida: true, motivo: 'no se encontró el CSV' }); continue; }
    const { columnas, filas } = tablaCsv(texto);
    if (columnas.length === 0) { resumen.push({ hoja: t.hoja, filas: 0, omitida: true, motivo: 'el CSV está vacío' }); continue; }
    const util = filas.filter((f) => Object.values(f).some((v) => v !== ''));
    resumen.push({ hoja: t.hoja, filas: util.length });
    if (util.length === 0) continue;
    for (let i = 0; i < util.length; i += TAMANO_TANDA) {
      const datos = JSON.stringify(util.slice(i, i + TAMANO_TANDA));
      let tag; do { tag = '$d' + crypto.randomBytes(4).toString('hex') + '$'; } while (datos.includes(tag));
      const hdr = columnas.filter((c) => c).map((c) => "'" + c.replace(/'/g, "''") + "'").join(', ');
      bloques.push(`do $x$ begin perform pg_temp.restaurar_tabla('${t.tabla}', ${tag}${datos}${tag}::jsonb, array[${hdr}]::text[], ${t.actualizar ? 'true' : 'false'}, array[${(t.fkPerfil ?? []).map((c) => `'${c}'`).join(', ')}]::text[], ${t.requiereAuth ? 'true' : 'false'}); end $x$;`);
    }
  }
  const hayRecepciones = resumen.find((r) => r.hoja === 'recepciones' && r.filas > 0);
  const sql = [
    '-- Prodmazul · restauración desde Google Sheets (generado por herramientas/restaurar-desde-sheets.mjs).',
    '-- Solo AGREGA lo que falta; no pisa ni borra datos. No contiene contraseñas ni claves.',
    'begin;',
    'create temp table _restauracion (tabla text, filas_en_la_copia bigint, filas_nuevas bigint) on commit drop;',
    AUX,
    FUNCION,
    ...bloques,
    hayRecepciones ? `-- Los contadores diarios de los números REC-AAAAMMDD-NNNN se reconstruyen para no repetir números.
insert into m01_recepcion.contadores (fecha, ultimo)
select to_date(substr(recepcion_id, 5, 8), 'YYYYMMDD'), max(substr(recepcion_id, 14)::integer)
from m01_recepcion.recepciones group by 1
on conflict (fecha) do update set ultimo = greatest(m01_recepcion.contadores.ultimo, excluded.ultimo);` : '',
    'select tabla, filas_en_la_copia, filas_nuevas from _restauracion;',
    'commit;',
    '',
  ].join('\n');
  return { sql, resumen };
}

function principal(argv) {
  const a = { carpeta: null, salida: 'restauracion.sql', incluirUsuarios: false, incluirConfig: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--carpeta') a.carpeta = argv[++i];
    else if (argv[i] === '--salida') a.salida = argv[++i];
    else if (argv[i] === '--incluir-usuarios') a.incluirUsuarios = true;
    else if (argv[i] === '--incluir-config') a.incluirConfig = true;
    else { console.error(`Opción desconocida: ${argv[i]}`); return 2; }
  }
  if (!a.carpeta || !fs.existsSync(a.carpeta) || !fs.statSync(a.carpeta).isDirectory()) {
    console.error('Indica la carpeta con los CSV: --carpeta <ruta>');
    return 2;
  }
  const nombres = fs.readdirSync(a.carpeta).filter((n) => /\.csv$/i.test(n));
  const archivos = {};
  for (const t of TABLAS) {
    const n = archivoDeHoja(nombres, t.hoja);
    if (n) archivos[t.hoja] = fs.readFileSync(path.join(a.carpeta, n), 'utf8');
  }
  const { sql, resumen } = construirSql(archivos, a);
  fs.writeFileSync(a.salida, sql, 'utf8');
  console.log('\nRestauración desde Google Sheets: resumen (no se muestra ningún dato)');
  for (const r of resumen) console.log(`  ${r.omitida ? '–' : '✔'} ${r.hoja.padEnd(26)} ${r.omitida ? 'omitida: ' + r.motivo : r.filas + ' fila(s)'}`);
  const faltan = resumen.filter((r) => r.omitida && r.motivo === 'no se encontró el CSV');
  console.log(`\nSe escribió ${a.salida}. Revísalo antes de ejecutarlo y ejecútalo SOLO en la base donde quieras recuperar los datos.`);
  if (faltan.length) console.log(`Atención: faltan ${faltan.length} CSV (${faltan.map((f) => f.hoja).join(', ')}).`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(principal(process.argv.slice(2)));
