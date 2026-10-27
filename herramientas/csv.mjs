// Lector mínimo de CSV (comillas dobles, saltos de línea dentro de una celda, CRLF y BOM). Sin dependencias.
export function leerCsv(texto) {
  const t = texto.replace(/^﻿/, '');
  const filas = [];
  let fila = [], celda = '', comillas = false, hay = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"') { if (t[i + 1] === '"') { celda += '"'; i++; } else comillas = false; }
      else celda += c;
    } else if (c === '"') { comillas = true; hay = true; }
    else if (c === ',') { fila.push(celda); celda = ''; hay = true; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      if (hay || celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
      fila = []; celda = ''; hay = false;
    } else { celda += c; hay = true; }
  }
  if (hay || celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

/** Devuelve { columnas, filas: [{columna: texto}] }. */
export function tablaCsv(texto) {
  const f = leerCsv(texto);
  if (f.length === 0) return { columnas: [], filas: [] };
  const columnas = f[0].map((c) => c.trim());
  const filas = f.slice(1).filter((r) => r.some((x) => x !== '')).map((r) => Object.fromEntries(columnas.map((c, i) => [c, r[i] ?? ''])));
  return { columnas, filas };
}
