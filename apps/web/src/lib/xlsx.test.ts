import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { construirXlsx, letraColumna, nombreHoja, serieFecha, serieFechaHora, serieHora } from './xlsx';

describe('xlsx', () => {
  it('letras de columna', () => {
    expect(letraColumna(0)).toBe('A');
    expect(letraColumna(25)).toBe('Z');
    expect(letraColumna(26)).toBe('AA');
    expect(letraColumna(41)).toBe('AP');
  });
  it('series de fecha de Excel', () => {
    expect(serieFecha('2026-10-20')).toBe(46315);
    expect(serieFecha('xx')).toBeNull();
    expect(serieHora('12:00')).toBeCloseTo(0.5, 5);
    expect(serieFechaHora('2026-10-20T05:00:00Z')).toBeCloseTo(46315, 5); // 00:00 en Ecuador
  });
  it('nombre de hoja válido', () => {
    expect(nombreHoja('A:B/C?'.repeat(10)).length).toBeLessThanOrEqual(31);
    expect(nombreHoja('Hoja:1')).toBe('Hoja 1');
  });
  it('construye un zip con las partes mínimas y los datos', () => {
    const z = unzipSync(construirXlsx([{ nombre: 'Datos', columnas: [{ titulo: 'N', formato: 'dec1' }, { titulo: 'Texto' }], filas: [[-3, 'a & <b>'], [null, '']] }]));
    expect(Object.keys(z)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']));
    const hoja = strFromU8(z['xl/worksheets/sheet1.xml']);
    expect(hoja).toContain('-3');
    const todo = Object.values(z).map((b) => strFromU8(b)).join('');
    expect(todo).toContain('a &amp; &lt;b&gt;');
  });
});
