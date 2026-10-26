// Pruebas de la LÓGICA del receptor (Codigo.gs) con una simulación de Google. Ejecutar: node receptor.test.mjs
import { crearEntorno } from './mock_google.mjs';

let ok = 0, mal = 0;
const t = (nombre, cond, extra = '') => { if (cond) { ok++; console.log('  ✔', nombre); } else { mal++; console.log('  ✘', nombre, extra); } };
const TOKEN = 'T'.repeat(40);

function nuevo(opts) {
  const R = crearEntorno(opts);
  const base = R.nuevoLibro('Prodmazul_Respaldo_2026');
  base.insertSheet('_conexion');
  R.props.TOKEN = TOKEN; R.props.SHEET_ID = base.id; R.props.FOLDER_ID = '1carpeta';
  R.base = base;
  R.sync = (tablas, lote = 'lote-0001-prueba') => R.llamar({ token: TOKEN, accion: 'sincronizar', lote_id: lote, tablas });
  return R;
}
const prov = (id, nombre) => ({ id, nombre, nombre_normalizado: nombre.toLowerCase(), activo: true, creado_en: '2026-10-26T10:00:00-05:00', creado_por: null });
const tabla = (hoja, clave, filas, borrar = []) => ({ hoja, clave, filas, borrar });
const PROV = (filas, borrar) => tabla('proveedores', ['id'], filas, borrar);
const hoja = (R, nombre, libro = R.base) => libro.getSheetByName(nombre);
const datos = (h) => h.filas.slice(1).filter((f) => f.length);

console.log('\nEntrada y token');
{
  const R = nuevo();
  const p = R.llamar({ token: TOKEN, accion: 'ping' });
  t('ping responde ok con la versión', p.ok === true && p.version === '2.0');
  t('token incorrecto: no autorizado', R.llamar({ token: 'falso', accion: 'ping' }).error === 'no autorizado');
  t('token de otro largo: no autorizado', R.llamar({ token: TOKEN + 'x', accion: 'ping' }).error === 'no autorizado');
  t('sin token: no autorizado', R.llamar({ accion: 'ping' }).error === 'no autorizado');
  t('sincronizar sin token no escribe nada', R.llamar({ accion: 'sincronizar', lote_id: 'abcdefgh1', tablas: [PROV([prov('p1', 'A')])] }).error === 'no autorizado' && !hoja(R, 'proveedores'));
  t('texto que no es JSON: solicitud no válida', R.llamar('no es json').error === 'solicitud no valida');
  t('acción desconocida', R.llamar({ token: TOKEN, accion: 'borrar_todo' }).error === 'accion desconocida');
  t('sin TOKEN configurado nadie entra', (() => { delete R.props.TOKEN; return R.llamar({ token: '', accion: 'ping' }).error === 'no autorizado'; })());
  const R2 = nuevo();
  R2.llamar({ token: TOKEN, accion: 'prueba_hoja' });
  t('la prueba de la Fase 3 (prueba_hoja) se conserva', hoja(R2, '_conexion').filas.length === 1);
  t('el candado se libera siempre', R2.locks.tomados === R2.locks.liberados);
}

console.log('\nCrear, reenviar (sin duplicar), actualizar y borrar');
{
  const R = nuevo();
  const r1 = R.sync([PROV([prov('p1', 'Alfa'), prov('p2', 'Beta')])]);
  t('un lote nuevo se acepta', r1.ok === true && r1.procesadas === 2, JSON.stringify(r1));
  t('usa el libro 2026 que ya existía (no crea otro)', r1.libro_nuevo === false && Object.keys(R.archivos).length === 1);
  const h = hoja(R, 'proveedores');
  t('crea la pestaña con encabezado: clave primero, «sincronizado_en» al final',
    JSON.stringify(h.filas[0]) === JSON.stringify(['id', 'activo', 'creado_en', 'creado_por', 'nombre', 'nombre_normalizado', 'sincronizado_en']), JSON.stringify(h.filas[0]));
  t('escribe las 2 filas con su hora de sincronización', datos(h).length === 2 && datos(h)[0][6] === '2026-10-26T10:00:00-05:00');
  t('la pestaña queda con la primera fila inmovilizada y protegida con aviso', h.congeladas === 1 && h.protecciones.length === 1 && h.protecciones[0].aviso === true);
  const r2 = R.sync([PROV([prov('p1', 'Alfa'), prov('p2', 'Beta')])]);
  t('reenviar el MISMO lote no duplica filas', datos(h).length === 2 && r2.resumen[2026].proveedores.insertadas === 0 && r2.resumen[2026].proveedores.actualizadas === 2);
  R.sync([PROV([prov('p1', 'Alfa Nuevo')])]);
  t('un cambio actualiza la fila y no toca la otra', datos(h).length === 2 && datos(h)[0][4] === 'Alfa Nuevo' && datos(h)[1][4] === 'Beta');
  R.sync([PROV([], [{ id: 'p1' }])]);
  t('«borrar» elimina esa fila y deja la otra', datos(h).length === 1 && datos(h)[0][0] === 'p2');
  const r3 = R.sync([PROV([], [{ id: 'p2' }, { id: 'no-existe' }])]);
  t('borrar lo último y borrar algo que no existe no da error', r3.ok === true && datos(h).length === 0 && r3.resumen[2026].proveedores.borradas === 1);
  R.sync([PROV([prov('p3', 'Otra vez')])]);
  t('la pestaña sigue sirviendo después de vaciarla', datos(h).length === 1 && datos(h)[0][0] === 'p3');
  const r4 = R.sync([PROV([prov('p4', 'Primera'), prov('p4', 'Segunda')])]);
  t('si una clave se repite dentro del lote gana la última', datos(h).filter((f) => f[0] === 'p4').length === 1 && datos(h).find((f) => f[0] === 'p4')[4] === 'Segunda');
}

console.log('\nTipos de datos (se guardan tal cual)');
{
  const R = nuevo();
  R.sync([tabla('lotes', ['lote_id'], [{ lote_id: '001-002-003', activo: true, especie_id: null, valor: { a: 1 }, texto: '=1+1', cero: '001', numero: 12.5, grande: 'x'.repeat(60000) }])]);
  const h = hoja(R, 'lotes'); const enc = h.filas[0]; const f = h.filas[1];
  const v = (c) => f[enc.indexOf(c)];
  t('el texto «001» sigue siendo texto', v('cero') === '001');
  t('un texto que parece fórmula («=1+1») se guarda como texto', v('texto') === '=1+1');
  t('booleanos y números conservan su tipo', v('activo') === true && v('numero') === 12.5);
  t('null queda vacío y un objeto se guarda como JSON', v('especie_id') === '' && v('valor') === '{"a":1}');
  t('un texto de 60 000 caracteres se recorta a 49 000', v('grande').length === 49000);
}

console.log('\nClaves compuestas y lotes grandes');
{
  const R = nuevo();
  const gav = (n, p) => ({ recepcion_id: 'REC-20261026-0001', num_gaveta: n, peso_lb: p });
  const T = (f, b) => tabla('recepcion_gavetas', ['recepcion_id', 'num_gaveta'], f, b);
  R.sync([T([gav(1, 50), gav(2, 51), gav(3, 52)])]);
  R.sync([T([gav(1, 50), gav(2, 99), gav(3, 52)])]);
  const h = hoja(R, 'recepcion_gavetas');
  t('con clave compuesta no se duplica y se actualiza la gaveta correcta', datos(h).length === 3 && datos(h).find((f) => f[1] === 2)[2] === 99);
  R.sync([T([], [gav(2, 0)])]);
  t('se borra solo la gaveta indicada', datos(h).length === 2 && !datos(h).some((f) => f[1] === 2));

  const muchas = Array.from({ length: 1500 }, (_, i) => prov('m' + i, 'P' + i));
  const r = R.sync([PROV(muchas)]);
  const hp = hoja(R, 'proveedores');
  t('un lote de 1500 filas crece la hoja por encima de las 1000 filas iniciales', r.ok && datos(hp).length === 1500 && hp.maxFilas >= 1501, r.error);
  const r2 = R.sync([PROV([], muchas.map((m) => ({ id: m.id })))]);
  t('borrar las 1500 filas (todas) no choca con la regla de Google de filas inmovilizadas', r2.ok === true && datos(hp).length === 0, r2.error);
  t('lote de más de 2000 filas: se rechaza', R.sync([PROV(Array.from({ length: 2001 }, (_, i) => prov('z' + i, 'Z')))]).tipo === 'solicitud');
}

console.log('\nLibro del año');
{
  const R = nuevo();
  const T = (id) => tabla('recepciones', ['recepcion_id'], [{ recepcion_id: id, estado: 'cerrado', libras_planta: 100 }]);
  const r = R.sync([T('REC-20261026-0001'), T('REC-20270105-0001')]);
  t('un registro de 2027 crea el libro «Prodmazul_Respaldo_2027»', r.ok && r.libro_nuevo === true && JSON.stringify(r.libros_nuevos) === '[2027]', JSON.stringify(r));
  const l27 = Object.values(R.archivos).find((l) => l.nombre === 'Prodmazul_Respaldo_2027');
  t('el libro nuevo trae una pestaña «_info» y la de la tabla', !!l27 && !!l27.getSheetByName('_info') && !!l27.getSheetByName('recepciones') && !l27.getSheetByName('Hoja 1'));
  t('cada registro va al libro de SU año', datos(hoja(R, 'recepciones')).length === 1 && datos(hoja(R, 'recepciones', l27)).length === 1);
  t('el ID del libro nuevo queda guardado', R.props.LIBRO_2027 === l27.id);
  const n = Object.keys(R.archivos).length;
  R.sync([T('REC-20270105-0001')]);
  t('el segundo envío reutiliza el libro (no crea otro)', Object.keys(R.archivos).length === n);
  t('las fotos y los hijos de recepción siguen al año de su recepción', (() => {
    R.sync([tabla('fotos_meta', ['foto_id'], [{ foto_id: 'FOT-M01-123-456-789-REC-20270105-0001-01', recepcion_id: 'REC-20270105-0001' }])]);
    return datos(hoja(R, 'fotos_meta', l27)).length === 1;
  })());
  t('un catálogo (sin año) va al libro del año actual', (() => {
    R.sync([PROV([prov('c1', 'Cat')])]);
    return datos(hoja(R, 'proveedores')).length === 1 && !hoja(R, 'proveedores', l27);
  })());
  const antes = Object.keys(R.archivos).length;
  const mal2 = R.sync([T('REC-20190101-0001')]);
  t('un año fuera de rango se rechaza y no crea libros', mal2.ok === false && mal2.tipo === 'solicitud' && Object.keys(R.archivos).length === antes);
  l27.papelera = true;
  const rp = R.sync([T('REC-20270105-0002')]);
  const nuevos = Object.values(R.archivos).filter((l) => l.nombre === 'Prodmazul_Respaldo_2027' && !l.papelera);
  t('si el libro está en la papelera se crea uno nuevo', rp.ok && rp.libro_nuevo && nuevos.length === 1 && R.props.LIBRO_2027 === nuevos[0].id);
}
{
  const R = nuevo();
  delete R.props.SHEET_ID;
  const huerfano = R.base; // existe en el Drive pero el script ya no tiene su ID
  const ajeno = R.nuevoLibro('Prodmazul_Respaldo_2027', 'otra.persona@gmail.com');
  const r = R.sync([tabla('recepciones', ['recepcion_id'], [{ recepcion_id: 'REC-20261026-0001' }, { recepcion_id: 'REC-20270101-0001' }])]);
  t('encuentra por nombre un libro propio que ya existía (no crea uno duplicado)', datos(huerfano.getSheetByName('recepciones')).length === 1 && r.libros_nuevos.indexOf(2026) < 0);
  const nuevo27 = Object.values(R.archivos).find((l) => l.nombre === 'Prodmazul_Respaldo_2027' && l.dueno === 'datos@gmail.com');
  t('ignora un libro del mismo nombre que pertenece a otra persona', !!nuevo27 && !ajeno.getSheetByName('recepciones'));
}

console.log('\nValidaciones (todo o nada)');
{
  const R = nuevo();
  const bien = PROV([prov('p1', 'A')]);
  const falla = (tablas) => { const r = R.sync(tablas); return r.ok === false && r.tipo === 'solicitud' && !hoja(R, 'proveedores'); };
  t('una pestaña que no está en la lista se rechaza', R.sync([tabla('usuarios', ['id'], [{ id: 1 }])]).error.startsWith('Pestana no permitida'));
  t('una clave distinta de la esperada se rechaza', falla([bien, tabla('lotes', ['id'], [{ id: 1 }])]));
  t('una fila sin clave se rechaza', falla([bien, tabla('lotes', ['lote_id'], [{ nombre: 'x' }])]));
  t('un nombre de columna raro se rechaza', falla([bien, tabla('lotes', ['lote_id'], [{ lote_id: 'a', 'col umna;': 1 }])]));
  t('«sincronizado_en» no se acepta como columna de datos', falla([bien, tabla('lotes', ['lote_id'], [{ lote_id: 'a', sincronizado_en: 'x' }])]));
  t('lote_id ausente o tablas vacías se rechazan', R.llamar({ token: TOKEN, accion: 'sincronizar', tablas: [bien] }).tipo === 'solicitud' && R.sync([]).tipo === 'solicitud');
  t('si una tabla es inválida NO se escribe ninguna (ni la válida)', !hoja(R, 'proveedores'));
  t('el mensaje de error no incluye el token', !JSON.stringify(R.sync([tabla('x', [], [])])).includes(TOKEN));
}

console.log('\nEstructura y columnas nuevas');
{
  const R = nuevo();
  R.sync([PROV([prov('p1', 'A'), prov('p2', 'B')])]);
  const h = hoja(R, 'proveedores');
  const f = { ...prov('p3', 'C'), color: 'azul' };
  R.sync([PROV([f])]);
  const enc = h.filas[0];
  t('una columna nueva se inserta ANTES de «sincronizado_en»', enc[enc.length - 1] === 'sincronizado_en' && enc.indexOf('color') === enc.length - 2, JSON.stringify(enc));
  t('las filas anteriores conservan sus datos y quedan con la columna nueva vacía', datos(h).length === 3 && datos(h)[0][enc.indexOf('nombre')] === 'A' && datos(h)[0][enc.indexOf('color')] === '' && datos(h)[2][enc.indexOf('color')] === 'azul');
  t('«sincronizado_en» sigue siendo la última columna en todas las filas', datos(h).every((x) => String(x[enc.length - 1]).startsWith('2026-')));
  h.filas[0][0] = 'otro';
  const antes = JSON.stringify(h.filas);
  const r = R.sync([PROV([prov('p9', 'Z')])]);
  t('si alguien cambió la estructura de la pestaña, no se escribe nada y se avisa', r.ok === false && r.error.includes('otra estructura') && JSON.stringify(h.filas) === antes);
}

console.log('\nTiempo, estado y reintentos');
{
  const R = nuevo();
  const T = (id) => tabla('recepciones', ['recepcion_id'], [{ recepcion_id: id }]);
  const lote = [T('REC-20260101-0001'), T('REC-20270101-0001')];
  // El segundo grupo empieza después del límite de tiempo.
  const original = R.ctx.escribirGrupo; let n = 0;
  R.ctx.escribirGrupo = function (...a) { const r = original.apply(this, a); if (++n === 1) R.avanzar(280000); return r; };
  const r = R.sync(lote);
  t('si se acaba el tiempo responde «parcial» con cuántas faltan', r.ok === false && r.parcial === true && r.procesadas === 1 && r.faltan === 1, JSON.stringify(r));
  R.ctx.escribirGrupo = original;
  const r2 = R.sync(lote);
  t('reenviar el lote completo termina el trabajo sin duplicar', r2.ok === true && datos(hoja(R, 'recepciones')).length === 1);
  const e = R.llamar({ token: TOKEN, accion: 'estado' });
  t('«estado» lista libros, pestañas y filas', e.ok && e.libros.length === 2 && e.libros.find((l) => l.anio === 2026).hojas.recepciones === 1);
  t('«estado» guarda el último lote y la hora', e.ultimo_lote === 'lote-0001-prueba' && /^2026-10-26T/.test(e.ultima_sync));
  t('el candado se liberó en todos los casos', R.locks.tomados === R.locks.liberados);
}

console.log('\nTabla ancha (recepciones tiene más de 26 columnas) y permisos');
{
  const R = nuevo();
  const f = { recepcion_id: 'REC-20261026-0001' }; for (let i = 1; i <= 44; i++) f['c' + String(i).padStart(2, '0')] = i;
  const r = R.sync([tabla('recepciones', ['recepcion_id'], [f])]);
  const h = hoja(R, 'recepciones');
  t('una pestaña de 46 columnas se crea y se llena (la cuadrícula inicial es de 26)', r.ok === true && h.filas[0].length === 46 && h.filas[1].length === 46, r.error);
  f.nueva = 'x'; const r2 = R.sync([tabla('recepciones', ['recepcion_id'], [f])]);
  t('y admite una columna nueva más', r2.ok === true && h.filas[0].length === 47 && h.filas[0][46] === 'sincronizado_en');
  t('autorizar() funciona con los servicios usados', R.ctx.autorizar().startsWith('Permisos correctos'));
}

console.log(`\nResultado: ${ok} correctas, ${mal} con fallo`);
process.exit(mal ? 1 : 0);
