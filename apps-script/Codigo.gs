/**
 * Prodmazul · Receptor de Google (Apps Script) · versión 2.2 · Fase 5 · Partes 2, 4 y 5
 *
 * Qué hace:
 *   - Recibe lotes de cambios desde Supabase y los escribe en el libro del año «Prodmazul_Respaldo_AAAA»
 *     (una pestaña por tabla; la última columna es «sincronizado_en»).
 *   - Actualiza o inserta por clave: reenviar el mismo lote NO duplica filas.
 *   - Borra las filas que Supabase indica como «borrar».
 *   - Crea el libro del año si no existe y protege cada pestaña contra edición manual (aviso).
 *   - (Parte 4) Guarda las fotos en Drive: baja cada foto desde una dirección temporal de Supabase y la deja en
 *     Prodmazul_Respaldo_Fotos/M01_Recepcion/AAAA/MM/REC-.../foto_NN.jpg (carpeta privada; no duplica si se reenvía).
 *   - Solo responde si recibe el TOKEN correcto (propiedad de la secuencia de comandos; nunca va en el código).
 *
 * Propiedades de la secuencia de comandos (Configuración del proyecto):
 *   TOKEN      token secreto de 40 caracteres            (ya existe)
 *   SHEET_ID   ID del libro «Prodmazul_Respaldo_2026»    (ya existe)
 *   - (Parte 5) Antes de borrar una foto de Supabase, comprueba que su copia siga en Drive (no en la papelera,
 *     con el mismo tamaño y la misma ruta anotada en su descripción).
 *   FOLDER_ID  ID de la carpeta de fotos                 (ya existe; la Parte 4 guarda aquí las fotos)
 *   LIBRO_AAAA ID de cada libro del año                  (las crea el propio script)
 *
 * Requiere el servicio avanzado «Google Sheets API» (Servicios > Agregar un servicio > Google Sheets API),
 * identificador «Sheets». Se usa para escribir los valores tal cual (RAW): un texto como «001» o «=1+1»
 * NO se convierte en número ni en fórmula.
 */
const VERSION = '2.2';
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

      case 'guardar_fotos':
        return salida(guardarFotos(body));

      case 'contar_fotos':
        return salida(contarFotos(body));

      case 'verificar_fotos':
        return salida(verificarFotos(body));

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
  DriveApp.getFolderById(PROPS.getProperty('FOLDER_ID')).getName();
  UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });  // pide el permiso de conexión externa (fotos)
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
  let fotos = { configurada: false };
  try {
    const raiz = carpetaRaiz();
    fotos = { configurada: true, carpeta: raiz.getName(), privada: raiz.getSharingAccess() === DriveApp.Access.PRIVATE };
  } catch (err) { fotos = { configurada: false, error: String(err && err.message ? err.message : err) }; }
  return { ok: true, version: VERSION, hora: new Date().toISOString(), ultimo_lote: PROPS.getProperty('ULTIMO_LOTE') || null,
           ultima_sync: PROPS.getProperty('ULTIMA_SYNC') || null, libros: libros, fotos: fotos };
}

// ------------------------------------------------------------------ fotos (Fase 5 · Parte 4)
const MAX_FOTOS_LLAMADA = 10;
const LIMITE_FOTOS_MS = 80000;          // dentro de una llamada; el resto queda para la próxima
const MAX_BYTES_FOTO = 6 * 1024 * 1024;  // Supabase admite 5 MB por foto
const EXT_FOTO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const RE_FOTO_ID = /^FOT-M01-[A-Za-z0-9-]{3,60}-\d{2}$/;
const RE_REC = /^REC-(\d{4})(\d{2})\d{2}-\d{4}$/;
// Solo se baja de una dirección temporal del almacenamiento de Supabase, del bucket de fotos de Recepción.
const RE_URL_FOTO = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/sign\/m01-recepcion-fotos\/[^\s?#]+\?token=[A-Za-z0-9._-]+(&[A-Za-z0-9=_.%-]*)?$/;

function carpetaRaiz() {
  const id = PROPS.getProperty('FOLDER_ID');
  if (!id) throw new ErrorSolicitud('Falta la propiedad FOLDER_ID (carpeta de fotos) en el script.');
  let c;
  try { c = DriveApp.getFolderById(id); } catch (err) { throw new ErrorSolicitud('No se encontró la carpeta de fotos (FOLDER_ID).'); }
  if (c.isTrashed()) throw new ErrorSolicitud('La carpeta de fotos está en la papelera.');
  return c;
}

function subcarpeta(padre, nombre, crear) {
  const it = padre.getFoldersByName(nombre);
  while (it.hasNext()) { const c = it.next(); if (!c.isTrashed()) return c; }
  return crear ? padre.createFolder(nombre) : null;
}

function validarFoto(f) {
  if (!f || typeof f !== 'object') throw new ErrorSolicitud('Foto no valida');
  if (typeof f.foto_id !== 'string' || !RE_FOTO_ID.test(f.foto_id)) throw new ErrorSolicitud('foto_id no valido');
  const m = typeof f.recepcion_id === 'string' ? RE_REC.exec(f.recepcion_id) : null;
  if (!m) throw new ErrorSolicitud('recepcion_id no valido en ' + f.foto_id);
  const anio = Number(m[1]), mes = Number(m[2]);
  if (anio < 2020 || anio > anioActual() + 1 || mes < 1 || mes > 12) throw new ErrorSolicitud('Fecha fuera de rango en ' + f.foto_id);
  if (f.foto_id.indexOf(f.recepcion_id) < 0) throw new ErrorSolicitud('foto_id y recepcion_id no coinciden en ' + f.foto_id);
  if (typeof f.nn !== 'number' || f.nn % 1 !== 0 || f.nn < 1 || f.nn > 5) throw new ErrorSolicitud('nn no valido en ' + f.foto_id);
  if (f.foto_id.slice(-2) !== (f.nn < 10 ? '0' : '') + f.nn) throw new ErrorSolicitud('nn no coincide con foto_id en ' + f.foto_id);
  if (!Object.prototype.hasOwnProperty.call(EXT_FOTO, f.tipo_mime)) throw new ErrorSolicitud('Tipo de imagen no permitido en ' + f.foto_id);
  if (typeof f.ruta !== 'string' || f.ruta.length < 5 || f.ruta.length > 300) throw new ErrorSolicitud('ruta no valida en ' + f.foto_id);
  if (typeof f.url !== 'string' || f.url.length > 2000 || !RE_URL_FOTO.test(f.url)) throw new ErrorSolicitud('Direccion de descarga no permitida en ' + f.foto_id);
  if (f.bytes_esperados !== undefined && f.bytes_esperados !== null &&
      (typeof f.bytes_esperados !== 'number' || f.bytes_esperados < 1 || f.bytes_esperados > MAX_BYTES_FOTO)) throw new ErrorSolicitud('bytes_esperados no valido en ' + f.foto_id);
  return { foto_id: f.foto_id, recepcion_id: f.recepcion_id, anio: m[1], mes: m[2], nn: f.nn, tipo_mime: f.tipo_mime,
           ruta: f.ruta, url: f.url, bytes_esperados: f.bytes_esperados || null };
}

function coincideFormato(bytes, mime) {
  const b = function (i) { return bytes[i] & 255; };
  if (mime === 'image/jpeg') return bytes.length > 3 && b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF;
  if (mime === 'image/png') return bytes.length > 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47;
  if (mime === 'image/webp') return bytes.length > 12 && b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50;
  return false;
}

function hex(bytes) {
  return bytes.map(function (x) { const h = (x & 255).toString(16); return h.length < 2 ? '0' + h : h; }).join('');
}

function respaldarFoto(raiz, f) {
  const carpeta = subcarpeta(subcarpeta(subcarpeta(subcarpeta(raiz, 'M01_Recepcion', true), f.anio, true), f.mes, true), f.recepcion_id, true);

  // ¿Ya está? Cada archivo guarda en su descripción la ruta única de la foto en Supabase: reenviar no duplica.
  const it = carpeta.getFiles();
  while (it.hasNext()) {
    const a = it.next();
    if (!a.isTrashed() && a.getDescription() === f.ruta) {
      return { foto_id: f.foto_id, ok: true, drive_file_id: a.getId(), bytes: a.getSize(), reutilizada: true };
    }
  }

  const resp = UrlFetchApp.fetch(f.url, { muteHttpExceptions: true, followRedirects: false });
  const codigo = resp.getResponseCode();
  if (codigo !== 200) return { foto_id: f.foto_id, ok: false, error: 'Supabase respondio ' + codigo + ' al descargar la foto' };
  const bytes = resp.getContent();
  const n = bytes.length;
  if (n === 0 || n > MAX_BYTES_FOTO) return { foto_id: f.foto_id, ok: false, error: 'La foto descargada tiene un tamano no valido (' + n + ' bytes)' };
  if (!coincideFormato(bytes, f.tipo_mime)) return { foto_id: f.foto_id, ok: false, error: 'El archivo descargado no es una imagen ' + f.tipo_mime };
  if (f.bytes_esperados && n !== f.bytes_esperados) {
    return { foto_id: f.foto_id, ok: false, error: 'Tamano distinto: se descargaron ' + n + ' bytes y se esperaban ' + f.bytes_esperados };
  }

  const ext = EXT_FOTO[f.tipo_mime];
  const nombre = 'foto_' + (f.nn < 10 ? '0' : '') + f.nn + '.' + ext;
  // Si ya hay otro archivo con ese nombre (se reemplazó la foto por otra), se conserva con otro nombre.
  const sello = Utilities.formatDate(new Date(), ZONA, "yyyy-MM-dd'T'HH:mm:ssXXX").replace(/\D/g, '').slice(0, 14);
  const previos = carpeta.getFilesByName(nombre);
  while (previos.hasNext()) {
    const a = previos.next();
    if (!a.isTrashed()) a.setName(a.getName().replace(/^(foto_\d{2})/, '$1_anterior_' + sello));
  }

  const archivo = carpeta.createFile(Utilities.newBlob(bytes, f.tipo_mime, nombre));
  archivo.setDescription(f.ruta);
  if (archivo.getSize() !== n) {
    archivo.setTrashed(true);
    return { foto_id: f.foto_id, ok: false, error: 'Drive guardo ' + archivo.getSize() + ' bytes y se esperaban ' + n };
  }
  return { foto_id: f.foto_id, ok: true, drive_file_id: archivo.getId(), bytes: n,
           sha256: hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)), reutilizada: false };
}

function guardarFotos(body) {
  const lista = body.fotos;
  if (!Array.isArray(lista) || lista.length < 1 || lista.length > MAX_FOTOS_LLAMADA) throw new ErrorSolicitud('fotos no valido (de 1 a ' + MAX_FOTOS_LLAMADA + ')');
  const plan = lista.map(validarFoto);   // se valida TODO antes de tocar Drive
  const raiz = carpetaRaiz();
  if (raiz.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    throw new ErrorSolicitud('La carpeta de fotos tiene un enlace compartido (acceso general). Cambia el acceso a «Restringido» y vuelve a intentar.');
  }
  const inicio = Date.now();
  const resultados = plan.map(function (f) {
    if (Date.now() - inicio > LIMITE_FOTOS_MS) return { foto_id: f.foto_id, ok: false, pendiente: true, error: 'No alcanzo el tiempo; se reintentara.' };
    try { return respaldarFoto(raiz, f); }
    catch (err) { return { foto_id: f.foto_id, ok: false, error: String(err && err.message ? err.message : err).slice(0, 300) }; }
  });
  return { ok: true, resultados: resultados, version: VERSION };
}

// (Parte 5) ¿Siguen en Drive las copias? SOLO LEE: no crea, mueve ni borra nada.
// Para cada foto comprueba: el archivo existe, no está en la papelera, pesa lo esperado y su descripción es la ruta de la foto.
const MAX_VERIFICAR = 100;
const RE_DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;
function verificarFotos(body) {
  const lista = body.fotos;
  if (!Array.isArray(lista) || lista.length < 1 || lista.length > MAX_VERIFICAR) throw new ErrorSolicitud('fotos no valido (de 1 a ' + MAX_VERIFICAR + ')');
  lista.forEach(function (f) {
    if (!f || typeof f.foto_id !== 'string' || !RE_FOTO_ID.test(f.foto_id)) throw new ErrorSolicitud('foto_id no valido');
    if (typeof f.drive_file_id !== 'string' || !RE_DRIVE_ID.test(f.drive_file_id)) throw new ErrorSolicitud('drive_file_id no valido en ' + f.foto_id);
    if (typeof f.ruta !== 'string' || f.ruta.length < 5 || f.ruta.length > 300) throw new ErrorSolicitud('ruta no valida en ' + f.foto_id);
    if (typeof f.bytes_esperados !== 'number' || !(f.bytes_esperados >= 1) || f.bytes_esperados > MAX_BYTES_FOTO) throw new ErrorSolicitud('bytes_esperados no valido en ' + f.foto_id);
  });
  const inicio = Date.now();
  const resultados = lista.map(function (f) {
    if (Date.now() - inicio > LIMITE_FOTOS_MS) return { foto_id: f.foto_id, ok: false, pendiente: true, error: 'No alcanzo el tiempo; se reintentara.' };
    try {
      const a = DriveApp.getFileById(f.drive_file_id);
      if (a.isTrashed()) return { foto_id: f.foto_id, ok: false, error: 'El archivo esta en la papelera de Drive.' };
      if (a.getSize() !== f.bytes_esperados) return { foto_id: f.foto_id, ok: false, error: 'El archivo de Drive pesa ' + a.getSize() + ' bytes y se esperaban ' + f.bytes_esperados + '.' };
      if (a.getDescription() !== f.ruta) return { foto_id: f.foto_id, ok: false, error: 'El archivo de Drive no corresponde a esta foto (la descripcion no coincide).' };
      return { foto_id: f.foto_id, ok: true, bytes: a.getSize() };
    } catch (err) {
      return { foto_id: f.foto_id, ok: false, error: 'No se pudo abrir el archivo en Drive.' };
    }
  });
  return { ok: true, resultados: resultados, version: VERSION };
}

// Cuenta las fotos guardadas de un mes (para comparar con Supabase). Recorre M01_Recepcion/AAAA/MM.
function contarFotos(body) {
  const anio = Number(body.anio), mes = Number(body.mes);
  if (!(anio >= 2020 && anio <= anioActual() + 1) || !(mes >= 1 && mes <= 12)) throw new ErrorSolicitud('anio o mes no validos');
  const raiz = carpetaRaiz();
  let dm = raiz;
  ['M01_Recepcion', String(anio), mes < 10 ? '0' + mes : String(mes)].forEach(function (n) { dm = dm ? subcarpeta(dm, n, false) : null; });
  if (!dm) return { ok: true, anio: anio, mes: mes, recepciones: 0, fotos: 0, completo: true, version: VERSION };
  const inicio = Date.now();
  let recepciones = 0, fotos = 0, completo = true;
  const carpetas = dm.getFolders();
  while (carpetas.hasNext()) {
    if (Date.now() - inicio > LIMITE_FOTOS_MS) { completo = false; break; }
    const c = carpetas.next();
    if (c.isTrashed()) continue;
    recepciones++;
    const archivos = c.getFiles();
    while (archivos.hasNext()) {
      const a = archivos.next();
      if (!a.isTrashed() && /^foto_\d{2}\.(jpg|png|webp)$/.test(a.getName())) fotos++;
    }
  }
  return { ok: true, anio: anio, mes: mes, recepciones: recepciones, fotos: fotos, completo: completo, version: VERSION };
}
