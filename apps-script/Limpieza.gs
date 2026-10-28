/**
 * Prodmazul · Limpieza de Google para empezar en producción · Fase 5
 *
 * Este archivo es un archivo APARTE dentro del mismo proyecto de Apps Script del receptor (Codigo.gs).
 * Sus funciones NO se pueden llamar desde internet (no pasan por doPost): solo se ejecutan A MANO, desde el editor,
 * con el botón «Ejecutar». Así nadie puede borrar nada a distancia.
 *
 *   limpiarHojasParaProduccion()      Deja cada pestaña de cada libro «Prodmazul_Respaldo_AAAA» SOLO con su fila de
 *                                     nombres de columnas (borra todas las demás filas). No borra pestañas ni libros.
 *   limpiarFotosDriveParaProduccion() Envía a la PAPELERA de Drive el contenido de «M01_Recepcion» (carpeta de fotos).
 *                                     La papelera conserva los archivos 30 días: se pueden recuperar.
 *
 * Antes de ejecutar cada una: cambia la constante CONFIRMO de abajo a 'SI BORRAR TODO'. Sin eso, solo cuentan (simulación).
 * Vuelve a poner 'NO' al terminar.
 */
var CONFIRMO = 'NO';

function limpiarHojasParaProduccion() {
  const props = PropertiesService.getScriptProperties();
  const todas = props.getProperties();
  const libros = Object.keys(todas).filter(function (k) { return /^LIBRO_\d{4}$/.test(k); }).sort();
  const nombresHojas = Object.keys(HOJAS);
  const informe = [];
  libros.forEach(function (k) {
    const ss = abrirSiVive(todas[k]);
    if (!ss) { informe.push(k + ': libro no disponible (se omite)'); return; }
    nombresHojas.forEach(function (nombre) {
      const hoja = ss.getSheetByName(nombre);
      if (!hoja) return;
      const ultima = hoja.getLastRow();
      const filas = Math.max(0, ultima - 1);
      if (CONFIRMO === 'SI BORRAR TODO' && filas > 0) {
        // Se limpia el contenido (no se borran filas: Google no permite borrar todas las filas no congeladas).
        Sheets.Spreadsheets.Values.clear({}, ss.getId(), "'" + nombre + "'!A2:" + letra(Math.max(1, hoja.getMaxColumns())) + hoja.getMaxRows());
      }
      informe.push(k + ' · ' + nombre + ': ' + filas + ' fila(s) ' + (CONFIRMO === 'SI BORRAR TODO' ? 'borradas' : 'se borrarían'));
    });
  });
  props.deleteProperty('ULTIMA_SYNC');
  props.deleteProperty('ULTIMO_LOTE');
  const texto = (CONFIRMO === 'SI BORRAR TODO' ? 'LIMPIEZA HECHA' : 'SIMULACIÓN (no se borró nada)') + '\n' + informe.join('\n');
  Logger.log(texto);
  return texto;
}

function limpiarFotosDriveParaProduccion() {
  const raiz = carpetaRaiz();
  const it = raiz.getFoldersByName('M01_Recepcion');
  let n = 0;
  while (it.hasNext()) {
    const carpeta = it.next();
    const sub = carpeta.getFolders();
    while (sub.hasNext()) {
      const c = sub.next();
      n++;
      if (CONFIRMO === 'SI BORRAR TODO') c.setTrashed(true);
    }
    const archivos = carpeta.getFiles();
    while (archivos.hasNext()) { const a = archivos.next(); n++; if (CONFIRMO === 'SI BORRAR TODO') a.setTrashed(true); }
  }
  const texto = (CONFIRMO === 'SI BORRAR TODO' ? 'Enviado a la papelera: ' : 'SIMULACIÓN, se enviarían a la papelera: ') + n + ' carpeta(s)/archivo(s) dentro de M01_Recepcion';
  Logger.log(texto);
  return texto;
}
