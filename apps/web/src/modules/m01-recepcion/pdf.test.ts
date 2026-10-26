import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
// @ts-ignore: node:fs solo se usa en pruebas (entorno node)
import { readFileSync } from 'node:fs';
import { envolver, generarPdfRecepcion, hojasNecesarias, limpiarTexto, nombreArchivoPdf, pesoTexto, promedioDeBloque, temperaturaTexto } from './pdf';
import type { RecepcionDetalle } from './tipos';

function recepcion(nBines: number, nTemps: number, obs = '', estado = 'cerrado'): RecepcionDetalle {
  return {
    recepcion_id: 'REC-20261024-0007', version: 3, estado, estado_previo: null, fecha_llegada: '2026-10-24', placa_vehiculo: 'ABC-1234', lote_id: 'L-001/2026',
    piscina: 'P12', guia_remision: '001-001-000123456', llegada_en: 'bines', num_gavetas_bines: 12, libras_reportadas: 5000, libras_planta: 4890.5, diferencia_lb: -109.5, diferencia_pct: -2.19,
    hora_inicio_descarga: '09:05:00', hora_fin_descarga: '11:40:00', observacion: obs, proveedor_nombre: 'Camaronera Ñandú S.A.', especie_nombre: 'Litopenaeus vannamei',
    realizado_por_nombre: 'Jossua Pérez', lote_cerrado: false, creado_por: 'u', modificado_en: '2026-10-24T17:00:00Z', motivo_anulacion: null, anulado_en: null, eliminado_en: null,
    gavetas: Array.from({ length: 30 }, (_, i) => ({ num_gaveta: i + 1, peso_lb: 40 + (i % 7) })),
    temperaturas: Array.from({ length: nTemps }, (_, i) => ({ lectura_id: i + 1, num_gaveta: i + 1, temperatura_c: 3.5 })),
    almacenamiento: Array.from({ length: nBines }, (_, i) => ({ num_bin: i + 1, sellos_recepcion: `R-${i}`, sellos_almacenamiento: `A-${i}`, temperatura_c: 2.5, libras_aprox: 400 })),
    fotos: [],
  } as unknown as RecepcionDetalle;
}
const ahora = new Date('2026-10-25T15:30:00Z');

describe('ayudas del PDF', () => {
  it('limpia texto raro', () => {
    expect(limpiarTexto('Ñandú\n  café')).toBe('Ñandú café');
    expect(limpiarTexto('hola 😀 x')).toBe('hola ? x');
    expect(limpiarTexto(null)).toBe('');
  });
  it('nombre de archivo seguro', () => {
    expect(nombreArchivoPdf({ recepcion_id: 'REC-20261024-0007', lote_id: 'L 001/2026' })).toBe('Recepcion_REC-20261024-0007_lote-L-001-2026.pdf');
  });
  it('pesos en lb y en kg', () => {
    expect(pesoTexto(1234.5, 'lb')).toBe('1,234.50');
    expect(pesoTexto(220.462, 'kg')).toBe('100.00');
    expect(pesoTexto(null, 'lb')).toBe('');
    expect(temperaturaTexto(3.456)).toBe('3.46');
  });
  it('promedio por bloque ignora las gavetas vacías', () => {
    const g = [{ num_gaveta: 1, peso_lb: 10 }, { num_gaveta: 2, peso_lb: 20 }, { num_gaveta: 11, peso_lb: 30 }];
    expect(promedioDeBloque(g, 0)).toBe(15);
    expect(promedioDeBloque(g, 1)).toBe(30);
    expect(promedioDeBloque(g, 2)).toBeNull();
  });
  it('hojas necesarias', () => {
    expect(hojasNecesarias(10, 10, 2)).toBe(1);
    expect(hojasNecesarias(11, 3, 2)).toBe(2);
    expect(hojasNecesarias(2, 15, 2)).toBe(2);
  });
  it('envuelve texto largo y parte palabras gigantes', async () => {
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica);
    const l = envolver('palabra '.repeat(50), f, 8, 200);
    expect(l.length).toBeGreaterThan(3);
    expect(l.every((x) => f.widthOfTextAtSize(x, 8) <= 200)).toBe(true);
    const g = envolver('X'.repeat(300), f, 8, 100);
    expect(g.every((x) => f.widthOfTextAtSize(x, 8) <= 100)).toBe(true);
  });
});

describe('generarPdfRecepcion', () => {
  it('una hoja A4 horizontal con hasta 10 bines', async () => {
    const bytes = await generarPdfRecepcion(recepcion(10, 10, 'ok'), { unidad: 'lb', ahora });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const d = await PDFDocument.load(bytes);
    expect(d.getPageCount()).toBe(1);
    const { width, height } = d.getPage(0).getSize();
    expect(Math.round(width)).toBe(842);
    expect(Math.round(height)).toBe(595);
  });
  it('varias hojas con muchos bines, temperaturas u observación larga', async () => {
    expect((await PDFDocument.load(await generarPdfRecepcion(recepcion(25, 14, 'x'), { unidad: 'kg', ahora }))).getPageCount()).toBe(2);
    expect((await PDFDocument.load(await generarPdfRecepcion(recepcion(80, 30, 'obs '.repeat(500)), { unidad: 'lb', ahora }))).getPageCount()).toBeGreaterThanOrEqual(3);
    expect((await PDFDocument.load(await generarPdfRecepcion(recepcion(3, 3, 'obs larga '.repeat(100)), { unidad: 'lb', ahora }))).getPageCount()).toBe(2);
  });
  it('con logotipo real y sin él', async () => {
    const logo = new Uint8Array(readFileSync('public/logo.png'));
    const con = await generarPdfRecepcion(recepcion(5, 5), { unidad: 'lb', logo, ahora });
    const sin = await generarPdfRecepcion(recepcion(5, 5), { unidad: 'lb', ahora });
    expect(con.length).toBeGreaterThan(sin.length);
    const malo = await generarPdfRecepcion(recepcion(5, 5), { unidad: 'lb', logo: new Uint8Array([1, 2, 3]), ahora });
    expect(malo.length).toBeGreaterThan(1000);
  });
  it('no falla con datos vacíos o estados especiales', async () => {
    const r = recepcion(0, 0, '', 'anulado');
    Object.assign(r, { gavetas: [], libras_reportadas: null, libras_planta: null, motivo_anulacion: 'Error', anulado_en: '2026-10-25T10:00:00Z', piscina: null, placa_vehiculo: null });
    expect((await PDFDocument.load(await generarPdfRecepcion(r, { unidad: 'kg', ahora }))).getPageCount()).toBe(1);
  });
});
