/**
 * Prodmazul · Receptor de Google (Apps Script) · versión 2.0 · Fase 5 · Parte 2
 *
 * Qué hace:
 *   - Recibe lotes de cambios desde Supabase y los escribe en el libro del año «Prodmazul_Respaldo_AAAA»
 *     (una pestaña por tabla; la última columna es «sincronizado_en»).
 *   - Actualiza o inserta por clave: reenviar el mismo lote NO duplica filas.
 *   - Borra las filas que Supabase indica como «borrar».
 *   - Crea el libro del año si no existe y protege cada pestaña contra edición manual (aviso).
 *   - Solo responde si recibe el TOKEN correcto (propiedad de la secuencia de comandos; nunca va en el código).
 *
 * Propiedades de la secuencia de comandos (Configuración del proyecto):
 *   TOKEN      token secreto de 40 caracteres            (ya existe)
 *   SHEET_ID   ID del libro «Prodmazul_Respaldo_2026»    (ya existe)
 *   FOLDER_ID  ID de la carpeta de fotos                 (ya existe; se usa en la Parte 4)
 *   LIBRO_AAAA ID de cada libro del año                  (las crea el propio script)
 *
 * Requiere el servicio avanzado «Google Sheets API» (Servicios > Agregar un servicio > Google Sheets API),
 * identificador «Sheets». Se usa para escribir los valores tal cual (RAW): un texto como «001» o «=1+1»
 * NO se convierte en número ni en fórmula.
 */
const VERSION = '2.0';
const PROPS = PropertiesService.getScriptProperties();
const ZONA = 'America/Guayaquil';
const MAX_FILAS_LOTE = 2000;     // filas (cambios + borrados) por lote
const LIMITE_MS = 270000;        // 4,5 min: Google corta a los 6 min
const MAX_CELDA = 49000;         // Google Sheets admite 50 000 caracteres por celda
const MAX_COLUMNAS = 80;
const COL_SYNC = 'sincronizado_en';

// Lista CERRADA de pestañas que este script acepta, con sus columnas clave (en este orden).
const HOJAS = {
  proveedores: ['id'],
  especies: ['id'],
  lotes: ['lote_id'],
  perfiles: ['user_id'],
  usuario_modulo_rol: ['user_id', 'modulo_id'],
  config: ['clave'],
  recepciones: ['recepcion_id'],
  recepcion_gavetas: ['recepcion_id', 'num_gaveta'],
  recepcion_temperaturas: ['recepcion_id', 'lectura_id'],
  recepcion_almacenamiento: ['recepcion_id', 'num_bin'],
  fotos_meta: ['foto_id']
};

class ErrorSolicitud extends Error {}

// ------------------------------------------------------------------ entrada
function doPost(e) {
  const lock = LockService.getScriptLock();
  let bloqueado = false;
  try {
    let body;
    try { body = JSON.parse(e.postData.contents); } catch (err) { return salida({ ok: false, error: 'solicitud no valida' }); }
    if (!body || typeof body !== 'object' || !tokenValido(body.token)) {
      return salida({ ok: false, error: 'no autorizado' });
    }
    lock.waitLock(20000);
    bloqueado = true;

    switch (body.accion) {
      case 'ping':
        return salida({ ok: true, hora: new Date().toISOString(), version: VERSION });

      case 'sincronizar':
        return salida(sincronizar(body));

      case 'estado':
        return salida(estado());

      // Pruebas de la Fase 3 (se conservan)
      case 'prueba_hoja': {
        const hoja = SpreadsheetApp.openById(PROPS.getProperty('SHEET_ID')).getSheetByName('_conexion');
        hoja.appendRow([new Date(), 'prueba de conexion']);
        return salida({ ok: true });
      }
      case 'prueba_foto': {
        const carpeta = DriveApp.getFolderById(PROPS.getProperty('FOLDER_ID'));
        const blob = Utilities.newBlob(Utilities.base64Decode(body.base64), body.mime, body.nombre);
        return salida({ ok: true, id: carpeta.createFile(blob).getId() });
      }

      default:
        return salida({ ok: false, error: 'accion desconocida' });
    }
  } catch (err) {
    if (err instanceof ErrorSolicitud) return salida({ ok: false, error: err.message, tipo: 'solicitud' });
    return salida({ ok: false, error: 'Error interno: ' + String(err && err.message ? err.message : err) });
  } finally {
    if (bloqueado) lock.releaseLock();
  }
}

// Solo para dar los permisos desde el editor (Ejecutar > autorizar). No la llama nadie desde fuera.
function autorizar() {
  const ss = SpreadsheetApp.openById(PROPS.getProperty('SHEET_ID'));
  Sheets.Spreadsheets.Values.get(ss.getId(), "'" + ss.getSheets()[0].getName() + "'!A1");
  DriveApp.getFilesByName('Prodmazul_Respaldo_' + anioActual()).hasNext();
  Session.getEffectiveUser().getEmail();  // pide el permiso de correo, que usa la busqueda de libros por nombre
  return 'Permisos correctos: ' + ss.getName();
}

function salida(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

function tokenValido(token) {
  const esperado = PROPS.getProperty('TOKEN');
  if (!esperado || esperado.length < 20 || typeof token !== 'string' || token.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ token.charCodeAt(i);
  return dif === 0;
}

// ------------------------------------------------------------------ sincronizar
function sincronizar(body) {
  const inicio = Date.now();
  const plan = validar(body);
  const ahora = Utilities.formatDate(new Date(), ZONA, "yyyy-MM-dd'T'HH:mm:ssXXX");
  const cache = {};
  const resumen = {};
  const librosNuevos = [];
  let procesadas = 0;

  for (const g of plan.grupos) {
    if (Date.now() - inicio > LIMITE_MS) {
      return { ok: false, parcial: true, lote_id: body.lote_id, procesadas: procesadas, faltan: plan.total - procesadas,
               error: 'Tiempo agotado: se procesaron ' + procesadas + ' de ' + plan.total + ' filas. Reenvía el lote (es seguro repetirlo).' };
    }
    const libro = obtenerLibro(g.anio, cache);
    if (libro.nuevo && librosNuevos.indexOf(g.anio) < 0) librosNuevos.push(g.anio);
    const r = escribirGrupo(libro, g, ahora);
    resumen[g.anio] = resumen[g.anio] || {};
    resumen[g.anio][g.hoja] = r;
    procesadas += g.filas.length + g.borrar.length;
  }
  PROPS.setProperty('ULTIMO_LOTE', String(body.lote_id));
  PROPS.setProperty('ULTIMA_SYNC', ahora);
  return { ok: true, lote_id: body.lote_id, procesadas: procesadas, resumen: resumen,
           libro_nuevo: librosNuevos.length > 0, libros_nuevos: librosNuevos, version: VERSION };
}

function anioActual() { return Number(Utilities.formatDate(new Date(), ZONA, 'yyyy')); }

// El año de un registro de recepción sale de su número REC-AAAAMMDD-#### (también dentro del id de foto).
function anioDe(obj) {
  const fuente = String(obj.recepcion_id || obj.foto_id || '');
  const m = /REC-(\d{4})\d{4}-\d{4}/.exec(fuente);
  return m ? Number(m[1]) : null;
}

function validar(body) {
  if (typeof body.lote_id !== 'string' || body.lote_id.length < 8 || body.lote_id.length > 64) throw new ErrorSolicitud('lote_id no valido');
  if (!Array.isArray(body.tablas) || body.tablas.length < 1 || body.tablas.length > 30) throw new ErrorSolicitud('tablas no valido');
  const actual = anioActual();
  const grupos = {};
  let total = 0;

  body.tablas.forEach(function (t) {
    if (!t || typeof t.hoja !== 'string' || !Object.prototype.hasOwnProperty.call(HOJAS, t.hoja)) {
      throw new ErrorSolicitud('Pestana no permitida: ' + (t && t.hoja));
    }
    const claves = HOJAS[t.hoja];
    if (!Array.isArray(t.clave) || JSON.stringify(t.clave) !== JSON.stringify(claves)) {
      throw new ErrorSolicitud('La clave de «' + t.hoja + '» no coincide con la esperada (' + claves.join(', ') + ')');
    }
    const filas = t.filas === undefined ? [] : t.filas;
    const borrar = t.borrar === undefined ? [] : t.borrar;
    if (!Array.isArray(filas) || !Array.isArray(borrar)) throw new ErrorSolicitud('filas y borrar deben ser listas (' + t.hoja + ')');
    total += filas.length + borrar.length;
    if (total > MAX_FILAS_LOTE) throw new ErrorSolicitud('Lote demasiado grande (maximo ' + MAX_FILAS_LOTE + ' filas)');

    const poner = function (obj, tipo) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new ErrorSolicitud('Fila no valida en «' + t.hoja + '»');
      claves.forEach(function (c) {
        if (obj[c] === null || obj[c] === undefined || obj[c] === '') throw new ErrorSolicitud('Falta la clave «' + c + '» en una fila de «' + t.hoja + '»');
      });
      if (tipo === 'filas') {
        const nombres = Object.keys(obj);
        if (nombres.length > MAX_COLUMNAS) throw new ErrorSolicitud('Demasiadas columnas en «' + t.hoja + '»');
        nombres.forEach(function (n) {
          if (!/^[a-z_][a-z0-9_]{0,60}$/.test(n) || n === COL_SYNC) throw new ErrorSolicitud('Nombre de columna no valido: ' + n);
        });
      }
      let anio = anioDe(obj);
      if (anio === null) anio = actual;
      if (anio < 2020 || anio > actual + 1) throw new ErrorSolicitud('Año fuera de rango (' + anio + ') en «' + t.hoja + '»');
      const k = anio + '|' + t.hoja;
      grupos[k] = grupos[k] || { anio: anio, hoja: t.hoja, claves: claves, filas: [], borrar: [] };
      grupos[k][tipo].push(obj);
    };
    filas.forEach(function (f) { poner(f, 'filas'); });
    borrar.forEach(function (b) { poner(b, 'borrar'); });
  });
  const lista = Object.keys(grupos).sort().map(function (k) { return grupos[k]; });
  return { grupos: lista, total: total };
}

// ------------------------------------------------------------------ libros del año
function obtenerLibro(anio, cache) {
  if (cache[anio]) return cache[anio];
  const nombre = 'Prodmazul_Respaldo_' + anio;
  let ss = null;
  const guardado = PROPS.getProperty('LIBRO_' + anio);
  if (guardado) ss = abrirSiVive(guardado);
  if (!ss) {
    const idBase = PROPS.getProperty('SHEET_ID');
    const base = idBase ? abrirSiVive(idBase) : null;
    if (base && base.getName() === nombre) ss = base;
  }
  if (!ss) ss = buscarPorNombre(nombre);
  let nuevo = false;
  if (!ss) {
    ss = SpreadsheetApp.create(nombre);
    prepararLibroNuevo(ss, anio);
    nuevo = true;
  }
  PROPS.setProperty('LIBRO_' + anio, ss.getId());
  cache[anio] = { ss: ss, anio: anio, nuevo: nuevo, pestanas: {} };
  return cache[anio];
}

function abrirSiVive(id) {
  try {
    if (DriveApp.getFileById(id).isTrashed()) return null;
    return SpreadsheetApp.openById(id);
  } catch (err) { return null; }
}

// Solo libros que son de esta cuenta (nunca uno que otra persona haya compartido con el mismo nombre).
function buscarPorNombre(nombre) {
  const it = DriveApp.getFilesByName(nombre);
  let yo = null;
  try { yo = Session.getEffectiveUser().getEmail(); } catch (err) { yo = null; }  // si falta el permiso de correo, no se exige
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed() || f.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
    const dueno = f.getOwner();
    if (!yo || (dueno && dueno.getEmail() === yo)) return SpreadsheetApp.openById(f.getId());
  }
  return null;
}

function prepararLibroNuevo(ss, anio) {
  const hoja = ss.getSheets()[0];
  hoja.setName('_info');
  hoja.getRange(1, 1, 3, 1).setValues([
    ['Respaldo automático de Prodmazul · año ' + anio],
    ['Esta copia se escribe sola desde Supabase cada 2 horas. No edites las pestañas a mano: se sobrescriben.'],
    ['Script receptor versión ' + VERSION]
  ]);
}

// ------------------------------------------------------------------ pestañas
function letra(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function celda(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  return v.length > MAX_CELDA ? v.slice(0, MAX_CELDA) : v;
}

function columnasDe(claves, filas) {
  const otras = {};
  filas.forEach(function (f) { Object.keys(f).forEach(function (k) { if (claves.indexOf(k) < 0) otras[k] = true; }); });
  return claves.concat(Object.keys(otras).sort());
}

function obtenerPestana(libro, hoja, claves, filas) {
  if (libro.pestanas[hoja]) return libro.pestanas[hoja];
  const ss = libro.ss;
  let sheet = ss.getSheetByName(hoja);
  let header;
  if (!sheet) {
    sheet = ss.insertSheet(hoja);
    header = columnasDe(claves, filas).concat([COL_SYNC]);
    if (sheet.getMaxColumns() < header.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), header.length - sheet.getMaxColumns());
    Sheets.Spreadsheets.Values.update({ values: [header] }, ss.getId(), "'" + hoja + "'!A1", { valueInputOption: 'RAW' });
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#d9e8f5');
    const p = sheet.protect();
    p.setDescription('Respaldo automático de Prodmazul: no editar a mano');
    p.setWarningOnly(true);
  } else {
    const r = Sheets.Spreadsheets.Values.get(ss.getId(), "'" + hoja + "'!1:1", { valueRenderOption: 'UNFORMATTED_VALUE' });
    header = (r.values && r.values[0] ? r.values[0] : []).map(String);
    claves.forEach(function (c, i) {
      if (header[i] !== c) throw new ErrorSolicitud('La pestaña «' + hoja + '» tiene otra estructura (la columna ' + (i + 1) + ' debería ser «' + c + '»). No se modificó nada.');
    });
    // Columnas nuevas (por una migración futura): se insertan antes de «sincronizado_en».
    columnasDe(claves, filas).forEach(function (c) {
      if (header.indexOf(c) >= 0) return;
      let pos = header.indexOf(COL_SYNC);
      if (pos < 0) { pos = header.length; }
      else { sheet.insertColumnBefore(pos + 1); }
      if (sheet.getMaxColumns() < pos + 1) sheet.insertColumnsAfter(sheet.getMaxColumns(), pos + 1 - sheet.getMaxColumns());
      Sheets.Spreadsheets.Values.update({ values: [[c]] }, ss.getId(), "'" + hoja + "'!" + letra(pos + 1) + '1', { valueInputOption: 'RAW' });
      header.splice(pos, 0, c);
    });
    if (header.indexOf(COL_SYNC) < 0) {
      if (sheet.getMaxColumns() < header.length + 1) sheet.insertColumnsAfter(sheet.getMaxColumns(), 1);
      Sheets.Spreadsheets.Values.update({ values: [[COL_SYNC]] }, ss.getId(), "'" + hoja + "'!" + letra(header.length + 1) + '1', { valueInputOption: 'RAW' });
      header.push(COL_SYNC);
    }
  }
  libro.pestanas[hoja] = { sheet: sheet, header: header };
  return libro.pestanas[hoja];
}

function clavePara(obj, claves) {
  return claves.map(function (c) { return String(obj[c]); }).join('\u0001');
}

// Escribe un grupo (un año y una pestaña): actualiza, inserta y borra.
function escribirGrupo(libro, g, ahora) {
  const ss = libro.ss;
  const p = obtenerPestana(libro, g.hoja, g.claves, g.filas);
  const header = p.header;
  const ult = letra(header.length);
  const nombre = "'" + g.hoja + "'";

  // Índice de claves existentes: clave -> número de fila (las claves están siempre en las primeras columnas)
  const indice = {};
  const leidas = Sheets.Spreadsheets.Values.get(ss.getId(), nombre + '!A2:' + letra(g.claves.length), { valueRenderOption: 'UNFORMATTED_VALUE' });
  (leidas.values || []).forEach(function (fila, i) {
    if (!fila || fila.length < g.claves.length) return;
    indice[fila.slice(0, g.claves.length).map(String).join('\u0001')] = i + 2;
  });
  const hayDatos = (leidas.values || []).length;

  // Dentro del lote, si una clave se repite gana la última.
  const unicas = {};
  g.filas.forEach(function (f) { unicas[clavePara(f, g.claves)] = f; });

  const cambios = [];
  const nuevas = [];
  Object.keys(unicas).forEach(function (k) {
    const f = unicas[k];
    const valores = header.map(function (col) { return col === COL_SYNC ? ahora : celda(f[col]); });
    if (indice[k]) cambios.push({ range: nombre + '!A' + indice[k] + ':' + ult + indice[k], values: [valores] });
    else nuevas.push(valores);
  });

  for (let i = 0; i < cambios.length; i += 500) {
    Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: cambios.slice(i, i + 500) }, ss.getId());
  }
  for (let i = 0; i < nuevas.length; i += 500) {
    Sheets.Spreadsheets.Values.append({ values: nuevas.slice(i, i + 500) }, ss.getId(), nombre + '!A1',
      { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' });
  }

  // Borrados (de abajo hacia arriba para que los números de fila no se muevan)
  let borradas = 0;
  const filasBorrar = {};
  g.borrar.forEach(function (b) { const n = indice[clavePara(b, g.claves)]; if (n) filasBorrar[n] = true; });
  const numeros = Object.keys(filasBorrar).map(Number).sort(function (a, b) { return b - a; });
  if (numeros.length) {
    // Google no permite borrar TODAS las filas no inmovilizadas: se deja siempre alguna fila libre debajo.
    const sheet = p.sheet;
    if (sheet.getMaxRows() <= hayDatos + 1 + nuevas.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), 10);
    const pedidos = [];
    let i = 0;
    while (i < numeros.length) {
      let j = i;
      while (j + 1 < numeros.length && numeros[j + 1] === numeros[j] - 1) j++;
      pedidos.push({ deleteDimension: { range: { sheetId: sheet.getSheetId(), dimension: 'ROWS', startIndex: numeros[j] - 1, endIndex: numeros[i] } } });
      borradas += numeros[i] - numeros[j] + 1;
      i = j + 1;
    }
    Sheets.Spreadsheets.batchUpdate({ requests: pedidos }, ss.getId());
  }
  return { insertadas: nuevas.length, actualizadas: cambios.length, borradas: borradas };
}

// ------------------------------------------------------------------ estado
function estado() {
  const libros = [];
  const todas = PROPS.getProperties();
  Object.keys(todas).filter(function (k) { return /^LIBRO_\d{4}$/.test(k); }).sort().forEach(function (k) {
    const ss = abrirSiVive(todas[k]);
    if (!ss) { libros.push({ anio: Number(k.slice(6)), disponible: false }); return; }
    const hojas = {};
    ss.getSheets().forEach(function (s) {
      const n = s.getName();
      if (n.charAt(0) !== '_') hojas[n] = Math.max(0, s.getLastRow() - 1);
    });
    libros.push({ anio: Number(k.slice(6)), nombre: ss.getName(), url: ss.getUrl(), disponible: true, hojas: hojas });
  });
  return { ok: true, version: VERSION, hora: new Date().toISOString(), ultimo_lote: PROPS.getProperty('ULTIMO_LOTE') || null,
           ultima_sync: PROPS.getProperty('ULTIMA_SYNC') || null, libros: libros };
}
