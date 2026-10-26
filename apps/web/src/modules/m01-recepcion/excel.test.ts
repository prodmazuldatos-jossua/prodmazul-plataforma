import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { construirExcel, hojasExcel, nombreArchivoExcel, type DatosExportacion } from './excel';

const datos: DatosExportacion = {
  generado_en: '2026-10-25T04:16:00Z',
  recepciones: [{ recepcion_id: 'R-1', estado: 'cerrado', version: 2, fecha_llegada: '2026-10-24', lote_cerrado: true, libras_reportadas: 1000.5 }],
  gavetas: [{ recepcion_id: 'R-1', num_gaveta: 1, peso_lb: 20.5 }],
  temperaturas: [{ recepcion_id: 'R-1', lectura_id: 1, num_gaveta: 1, temperatura_c: -3 }],
  almacenamiento: [], fotos: [],
};

describe('exportación a Excel', () => {
  it('genera las 5 hojas con sus columnas', () => {
    const h = hojasExcel(datos);
    expect(h.map((x) => x.nombre)).toEqual(['Recepciones', 'Gavetas', 'Temperaturas', 'Almacenamiento', 'Fotos']);
    expect(h[0].columnas.length).toBeGreaterThanOrEqual(35);
    expect(h[0].filas[0].length).toBe(h[0].columnas.length);
  });
  it('traduce estado y sí/no; temperatura con un decimal', () => {
    const h = hojasExcel(datos);
    const i = h[0].columnas.findIndex((c) => c.titulo === 'Estado');
    expect(h[0].filas[0][i]).toBe('Cerrada');
    expect(h[0].filas[0]).toContain('Sí');
    expect(h[2].columnas[3].formato).toBe('dec1');
  });
  it('produce un archivo xlsx (zip) válido', () => {
    expect(Object.keys(unzipSync(construirExcel(datos)))).toContain('xl/worksheets/sheet5.xml');
  });
  it('nombre del archivo con hora de Ecuador', () => {
    expect(nombreArchivoExcel(new Date('2026-10-25T04:16:00Z'))).toBe('recepciones_2026-10-24_2316.xlsx');
  });
});
