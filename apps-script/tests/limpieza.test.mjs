// Pruebas de Limpieza.gs (limpieza de Google para producción) con la simulación de Google. Ejecutar: node tests/limpieza.test.mjs
import vm from 'node:vm';
import { crearEntorno } from './mock_google.mjs';

let ok = 0, mal = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('  ✔', n); } else { mal++; console.log('  ✘', n, x); } };
const TOKEN = 'T'.repeat(40);

function nuevo() {
  const R = crearEntorno();
  const base = R.nuevoLibro('Prodmazul_Respaldo_2026'); base.insertSheet('_conexion');
  R.props.TOKEN = TOKEN; R.props.SHEET_ID = base.id; R.raizFotos = R.nuevaCarpeta('Prodmazul_Respaldo_Fotos'); R.props.FOLDER_ID = R.raizFotos.id; R.base = base;
  R.sync = (tablas) => R.llamar({ token: TOKEN, accion: 'sincronizar', lote_id: 'lote-0001-prueba', tablas });
  return R;
}
const prov = (id) => ({ id, nombre: 'N' + id, nombre_normalizado: 'n', activo: true, creado_en: 'x', creado_por: null });
const rec = (id) => ({ recepcion_id: id, guia_remision: 'G', lote_id: '1-1-1', estado: 'cerrado' });
const llenar = (R) => {
  const r = R.sync([{ hoja: 'proveedores', clave: ['id'], filas: [prov('p1'), prov('p2')], borrar: [] }, { hoja: 'recepciones', clave: ['recepcion_id'], filas: [rec('REC-20261026-0001'), rec('REC-20261026-0002'), rec('REC-20261026-0003')], borrar: [] }]);
  if (!r.ok) throw new Error('no se pudo llenar: ' + JSON.stringify(r));
};
const datos = (h) => h.filas.slice(1).filter((f) => f.some((v) => v !== ''));
const ejecutar = (R, codigo) => vm.runInContext(codigo, R.ctx);

console.log('\nLimpieza de las hojas');
{
  const R = nuevo(); llenar(R);
  const h0 = R.base.getSheetByName('recepciones'); const cab0 = JSON.stringify(h0.filas[0]);
  t('antes: hay datos', datos(h0).length === 3 && datos(R.base.getSheetByName('proveedores')).length === 2);
  const sim = ejecutar(R, 'limpiarHojasParaProduccion()');
  t('por defecto es SIMULACIÓN y no borra nada', datos(h0).length === 3 && /SIMULACIÓN/.test(sim) && /recepciones: 3 fila/.test(sim), sim);
  ejecutar(R, "CONFIRMO = 'SI BORRAR TODO'");
  const r = ejecutar(R, 'limpiarHojasParaProduccion()');
  t('con confirmación: la pestaña recepciones queda sin filas de datos', datos(h0).length === 0);
  t('y proveedores también', datos(R.base.getSheetByName('proveedores')).length === 0);
  t('la fila de nombres de columnas se conserva intacta', JSON.stringify(h0.filas[0]) === cab0 && h0.filas[0].includes('recepcion_id') && h0.filas[0].includes('sincronizado_en'));
  t('no se borran pestañas', !!R.base.getSheetByName('proveedores') && !!R.base.getSheetByName('_conexion') && R.base.hojas.length >= 3);
  t('el informe dice LIMPIEZA HECHA', /LIMPIEZA HECHA/.test(r));
  t('se olvidan las marcas de último envío', !('ULTIMA_SYNC' in R.props) && !('ULTIMO_LOTE' in R.props));
  // el receptor sigue funcionando y vuelve a escribir debajo de los nombres
  llenar(R);
  t('después de limpiar, el receptor vuelve a escribir normalmente desde la fila 2', datos(h0).length === 3 && h0.filas[1][0] === 'REC-20261026-0001', JSON.stringify(h0.filas.slice(0, 3)));
  t('limpiar dos veces no falla', (() => { ejecutar(R, 'limpiarHojasParaProduccion()'); ejecutar(R, 'limpiarHojasParaProduccion()'); return datos(h0).length === 0; })());
}
console.log('\nSeguridad');
{
  const R = nuevo(); llenar(R);
  t('no se puede pedir por internet (no hay acción de limpieza en doPost)', R.llamar({ token: TOKEN, accion: 'limpiarHojasParaProduccion' }).error === 'accion desconocida' && R.llamar({ token: TOKEN, accion: 'limpiar' }).error === 'accion desconocida');
  t('CONFIRMO viene en «NO»', ejecutar(R, 'CONFIRMO') === 'NO');
}
console.log('\nLimpieza de las fotos de Drive');
{
  const R = nuevo();
  const m = R.raizFotos.createFolder('M01_Recepcion'); const a = m.createFolder('2026'); const mes = a.createFolder('10'); const rc = mes.createFolder('REC-20261026-0001'); rc.createFile({ n: 'foto_01.jpg', m: 'image/jpeg', b: [1, 2, 3] });
  const otra = R.raizFotos.createFolder('Otra'); 
  const sim = ejecutar(R, 'limpiarFotosDriveParaProduccion()');
  t('simulación: no manda nada a la papelera', !a.papelera && /SIMULACIÓN/.test(sim) && /1 carpeta/.test(sim), sim);
  ejecutar(R, "CONFIRMO = 'SI BORRAR TODO'");
  ejecutar(R, 'limpiarFotosDriveParaProduccion()');
  t('con confirmación: el año va a la papelera (recuperable)', a.papelera === true);
  t('la carpeta raíz y M01_Recepcion se conservan', !R.raizFotos.papelera && !m.papelera);
  t('no toca otras carpetas', !otra.papelera);
}
console.log(`\n${mal === 0 ? '✔' : '✘'} ${ok} correctas, ${mal} con fallo`);
process.exit(mal ? 1 : 0);
