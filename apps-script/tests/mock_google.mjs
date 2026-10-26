// Simulación mínima de Google (SpreadsheetApp, Sheets avanzado, DriveApp, etc.) para probar la LÓGICA del receptor sin Google.
// No sustituye la prueba real contra tu cuenta (guía, pasos de prueba), pero imita las reglas que más importan:
// límites de la cuadrícula, «no se pueden borrar todas las filas no inmovilizadas» y escritura RAW.
import vm from 'vm';
import fs from 'fs';
import crypto from 'crypto';

export function crearEntorno({ ahora = '2026-10-26T15:00:00Z', yo = 'datos@gmail.com' } = {}) {
  let reloj = new Date(ahora).getTime();
  const R = { avanzar: (ms) => { reloj += ms; }, archivos: {}, props: {}, locks: { tomados: 0, liberados: 0 }, contador: 0 };

  class Fecha extends Date {
    constructor(...a) { super(...(a.length ? a : [reloj])); }
    static now() { return reloj; }
  }

  const nuevoId = () => '1' + String(++R.contador).padStart(10, '0') + 'AbCdEf';
  function colNum(letras) { let n = 0; for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64); return n; }
  function celdaRef(s) { const m = /^([A-Z]+)(\d+)$/.exec(s); return { c: colNum(m[1]), r: Number(m[2]) }; }

  class Hoja {
    constructor(libro, nombre) {
      this.libro = libro; this.nombre = nombre; this.filas = []; this.maxFilas = 1000; this.maxCols = 26;
      this.congeladas = 0; this.protecciones = []; this.id = ++R.contador;
    }
    getName() { return this.nombre; } setName(n) { this.nombre = n; }
    getSheetId() { return this.id; }
    getMaxRows() { return this.maxFilas; } getMaxColumns() { return this.maxCols; }
    insertColumnsAfter(pos, n) { this.maxCols += n; }
    insertRowsAfter(pos, n) { this.maxFilas += n; }
    insertColumnBefore(col) { this.filas.forEach((f) => { if (f.length >= col) f.splice(col - 1, 0, ''); }); this.maxCols += 1; }
    setFrozenRows(n) { this.congeladas = n; }
    protect() { const p = { desc: '', aviso: false, setDescription(d) { this.desc = d; return this; }, setWarningOnly(b) { this.aviso = b; return this; } }; this.protecciones.push(p); return p; }
    appendRow(fila) { const r = this.getLastRow() + 1; fila.forEach((v, j) => this.poner(r, 1 + j, v)); }
    getLastRow() { let u = 0; this.filas.forEach((f, i) => { if (f && f.some((v) => v !== '' && v !== undefined)) u = i + 1; }); return u; }
    getRange(r, c, nr = 1, nc = 1) {
      const h = this;
      const rango = {
        setValues(v) { v.forEach((fila, i) => fila.forEach((x, j) => h.poner(r + i, c + j, x))); return rango; },
        setFontWeight() { return rango; }, setBackground() { return rango; }
      };
      return rango;
    }
    poner(r, c, v) {
      if (r > this.maxFilas || c > this.maxCols) throw new Error('Los valores exceden los límites de la cuadrícula (fila ' + r + ', columna ' + c + ')');
      while (this.filas.length < r) this.filas.push([]);
      const f = this.filas[r - 1]; while (f.length < c) f.push('');
      f[c - 1] = v;
    }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.libro.id; }
  }
  class Libro {
    constructor(nombre, dueno) {
      this.id = nuevoId(); this.nombre = nombre; this.dueno = dueno; this.papelera = false;
      this.hojas = [new Hoja(this, 'Hoja 1')]; R.archivos[this.id] = this;
    }
    getId() { return this.id; } getName() { return this.nombre; } getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
    getSheets() { return this.hojas; }
    getSheetByName(n) { return this.hojas.find((h) => h.nombre === n) || null; }
    insertSheet(n) { if (this.getSheetByName(n)) throw new Error('Ya existe una hoja con ese nombre'); const h = new Hoja(this, n); this.hojas.push(h); return h; }
  }
  R.nuevoLibro = (nombre, dueno = yo) => new Libro(nombre, dueno);

  function analizar(rango) {
    const m = /^'([^']+)'!(.+)$/.exec(rango); if (!m) throw new Error('Rango no válido: ' + rango);
    const [, hoja, resto] = m;
    let r1, c1, r2, c2;
    if (/^\d+:\d+$/.test(resto)) { const [a, b] = resto.split(':').map(Number); r1 = a; r2 = b; c1 = 1; c2 = Infinity; }
    else if (/^[A-Z]+\d+$/.test(resto)) { const p = celdaRef(resto); r1 = r2 = p.r; c1 = c2 = p.c; }
    else if (/^[A-Z]+\d+:[A-Z]+\d+$/.test(resto)) { const [a, b] = resto.split(':').map(celdaRef); r1 = a.r; c1 = a.c; r2 = b.r; c2 = b.c; }
    else if (/^[A-Z]+\d+:[A-Z]+$/.test(resto)) { const [a, b] = resto.split(':'); const p = celdaRef(a); r1 = p.r; c1 = p.c; r2 = Infinity; c2 = colNum(b); }
    else throw new Error('Rango no soportado: ' + rango);
    return { hoja, r1, c1, r2, c2 };
  }
  const buscarHoja = (id, nombre) => { const l = R.archivos[id]; if (!l) throw new Error('No existe el libro'); const h = l.getSheetByName(nombre); if (!h) throw new Error('No se encontró la hoja ' + nombre); return h; };

  const Sheets = { Spreadsheets: {
    Values: {
      get(id, rango) {
        const a = analizar(rango); const h = buscarHoja(id, a.hoja);
        const fin = Math.min(a.r2, h.filas.length); const out = [];
        for (let r = a.r1; r <= fin; r++) {
          const f = h.filas[r - 1] || []; const cortada = f.slice(a.c1 - 1, a.c2 === Infinity ? undefined : a.c2);
          while (cortada.length && cortada[cortada.length - 1] === '') cortada.pop();
          out.push(cortada);
        }
        while (out.length && out[out.length - 1].length === 0) out.pop();
        return out.length ? { values: JSON.parse(JSON.stringify(out)) } : {};
      },
      update(recurso, id, rango, opc) {
        if (!opc || opc.valueInputOption !== 'RAW') throw new Error('El receptor debe escribir en modo RAW');
        const a = analizar(rango); const h = buscarHoja(id, a.hoja);
        recurso.values.forEach((fila, i) => fila.forEach((v, j) => h.poner(a.r1 + i, a.c1 + j, v)));
        return {};
      },
      batchUpdate(recurso, id) {
        if (recurso.valueInputOption !== 'RAW') throw new Error('El receptor debe escribir en modo RAW');
        recurso.data.forEach((d) => { const a = analizar(d.range); const h = buscarHoja(id, a.hoja); d.values.forEach((fila, i) => fila.forEach((v, j) => h.poner(a.r1 + i, a.c1 + j, v))); });
        return {};
      },
      append(recurso, id, rango, opc) {
        if (!opc || opc.valueInputOption !== 'RAW') throw new Error('El receptor debe escribir en modo RAW');
        const a = analizar(rango); const h = buscarHoja(id, a.hoja);
        let ultima = h.getLastRow();
        recurso.values.forEach((fila) => { ultima++; if (ultima > h.maxFilas) h.maxFilas = ultima; fila.forEach((v, j) => h.poner(ultima, 1 + j, v)); });
        return {};
      }
    },
    batchUpdate(recurso, id) {
      recurso.requests.forEach((q) => {
        const d = q.deleteDimension.range; const h = Object.values(R.archivos).flatMap((l) => l.hojas).find((x) => x.id === d.sheetId && x.libro.id === id);
        if (!h) throw new Error('Hoja no encontrada');
        const n = d.endIndex - d.startIndex;
        if (h.maxFilas - n <= h.congeladas) throw new Error('No puedes eliminar todas las filas no inmovilizadas de una hoja');
        h.filas.splice(d.startIndex, n); h.maxFilas -= n;
      });
      return {};
    }
  } };

  // ---- Drive: carpetas y archivos (para las fotos)
  R.carpetas = {};
  const iter = (lista) => { let i = 0; return { hasNext: () => i < lista.length, next: () => lista[i++] }; };
  class ArchivoDrive {
    constructor(carpeta, nombre, mime, bytes) { this.id = nuevoId(); this.nombre = nombre; this.mime = mime; this.bytes = Buffer.from(bytes); this.desc = ''; this.papelera = false; this.carpeta = carpeta; }
    getId() { return this.id; } getName() { return this.nombre; } setName(n) { this.nombre = n; return this; }
    getDescription() { return this.desc; } setDescription(d) { this.desc = d; return this; }
    getSize() { return this.bytes.length; } isTrashed() { return this.papelera; } setTrashed(b) { this.papelera = b; return this; }
    getMimeType() { return this.mime; }
  }
  class CarpetaDrive {
    constructor(nombre, padre) { this.id = nuevoId(); this.nombre = nombre; this.padre = padre; this.sub = []; this.arch = []; this.papelera = false; this.acceso = 'PRIVATE'; R.carpetas[this.id] = this; }
    getId() { return this.id; } getName() { return this.nombre; } isTrashed() { return this.papelera; }
    getFoldersByName(n) { return iter(this.sub.filter((c) => c.nombre === n)); }
    getFolders() { return iter(this.sub.slice()); }
    createFolder(n) { const c = new CarpetaDrive(n, this); this.sub.push(c); return c; }
    getFiles() { return iter(this.arch.slice()); }
    getFilesByName(n) { return iter(this.arch.filter((a) => a.nombre === n)); }
    createFile(blob) { const a = new ArchivoDrive(this, blob.n, blob.m, blob.b); this.arch.push(a); return a; }
    getSharingAccess() { return this.acceso; }
  }
  R.nuevaCarpeta = (nombre) => new CarpetaDrive(nombre, null);
  R.red = () => ({ codigo: 404, bytes: [] });  // lo reemplaza cada prueba
  R.descargas = [];

  const archivoDrive = (l) => ({
    getId: () => l.id, isTrashed: () => l.papelera, getMimeType: () => 'application/vnd.google-apps.spreadsheet',
    getOwner: () => (l.dueno ? { getEmail: () => l.dueno } : null)
  });
  const ctx = vm.createContext({
    Date: Fecha, console, JSON, Math, Object, Array, String, Number, Error, RegExp,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in R.props ? R.props[k] : null), setProperty: (k, v) => { R.props[k] = String(v); },
      getProperties: () => ({ ...R.props }), deleteProperty: (k) => { delete R.props[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { R.locks.tomados++; }, releaseLock: () => { R.locks.liberados++; } }) },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (s) => ({ contenido: s, setMimeType() { return this; }, getContent() { return this.contenido; } }) },
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    Session: { getEffectiveUser: () => ({ getEmail: () => yo }) },
    Utilities: {
      formatDate(d, tz, f) { const e = new Date(d.getTime() - 5 * 3600e3); const p = (n) => String(n).padStart(2, '0');
        if (f === 'yyyy') return String(e.getUTCFullYear());
        return `${e.getUTCFullYear()}-${p(e.getUTCMonth() + 1)}-${p(e.getUTCDate())}T${p(e.getUTCHours())}:${p(e.getUTCMinutes())}:${p(e.getUTCSeconds())}-05:00`; },
      base64Decode: (s) => Buffer.from(s, 'base64'), newBlob: (b, m, n) => ({ b, m, n }),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (alg, bytes) => Array.from(crypto.createHash('sha256').update(Buffer.from(bytes)).digest(), (x) => (x > 127 ? x - 256 : x))
    },
    UrlFetchApp: { fetch: (url, opc) => {
      R.descargas.push({ url, opc });
      const r = R.red(url);
      return { getResponseCode: () => r.codigo, getContent: () => Array.from(Buffer.from(r.bytes), (x) => (x > 127 ? x - 256 : x)) };
    } },
    SpreadsheetApp: {
      create: (n) => new Libro(n, yo),
      openById: (id) => { const l = R.archivos[id]; if (!l) throw new Error('No se encontró el libro'); return l; }
    },
    DriveApp: {
      Access: { PRIVATE: 'PRIVATE', ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN: 'DOMAIN', DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK' },
      getFolderById: (id) => { const c = R.carpetas[id]; if (!c) throw new Error('No item with the given ID could be found'); return c; },
      getFileById: (id) => { const l = R.archivos[id]; if (!l) throw new Error('No item with the given ID could be found'); return archivoDrive(l); },
      getFilesByName: (n) => { const l = Object.values(R.archivos).filter((x) => x.nombre === n); let i = 0; return { hasNext: () => i < l.length, next: () => archivoDrive(l[i++]) }; }
    },
    Sheets
  });
  vm.runInContext(fs.readFileSync(new URL('../Codigo.gs', import.meta.url), 'utf8'), ctx);
  R.llamar = (body) => {
    const r = ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } });
    return JSON.parse(r.getContent());
  };
  R.ctx = ctx;
  return R;
}
