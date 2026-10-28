import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { construirExcel, hojaConsolidado, hojasExcel, nombreArchivoExcel, type DatosExportacion } from './excel';

const datos: DatosExportacion = {
  generado_en: '2026-10-25T04:16:00Z',
  recepciones: [{ recepcion_id: 'R-1', estado: 'cerrado', version: 2, fecha_llegada: '2026-10-24', lote_cerrado: true, libras_reportadas: 1000.5 }],
  gavetas: [{ recepcion_id: 'R-1', num_gaveta: 1, peso_lb: 20.5 }],
  temperaturas: [{ recepcion_id: 'R-1', lectura_id: 1, num_gaveta: 1, temperatura_c: -3 }],
  almacenamiento: [], fotos: [],
};

const rec = (extra: Record<string, unknown>) => ({
  recepcion_id: 'REC-20261024-0001', estado: 'cerrado', fecha_llegada: '2026-10-24', guia_remision: '001-002-000123', lote_id: '123-456-789',
  proveedor: 'Camaronera Sol', especie: 'Entero', llegada_en: 'bines', num_gavetas_bines: 12, libras_reportadas: '1000.50', libras_planta: '990.25', diferencia_lb: '-10.25',
  placa_vehiculo: 'ABC-123', observacion: 'no va', ...extra,
});

describe('hoja Consolidado', () => {
  const d: DatosExportacion = { ...datos, recepciones: [
    rec({}),
    rec({ recepcion_id: 'REC-20261024-0002', estado: 'borrador', llegada_en: 'gavetas', num_gavetas_bines: 1, libras_planta: null, diferencia_lb: null }),
    rec({ recepcion_id: 'REC-20261024-0003', estado: 'anulado' }),
    rec({ recepcion_id: 'REC-20261024-0004', estado: 'eliminado' }),
  ] };
  const h = hojaConsolidado(d);
  it('tiene solo las 10 columnas pedidas, en ese orden', () => {
    expect(h.nombre).toBe('Consolidado');
    expect(h.columnas.map((c) => c.titulo)).toEqual(['Recepción', 'Fecha', 'Guía', 'Lote', 'Proveedor', 'Especie', 'Llegó', 'Libras reportadas', 'Libras planta', 'Diferencia']);
    expect(h.filas.every((f) => f.length === 10)).toBe(true);
  });
  it('trae las recepciones vigentes (borrador y cerrada), sin las anuladas ni las eliminadas', () => {
    expect(h.filas.map((f) => f[0])).toEqual(['REC-20261024-0001', 'REC-20261024-0002']);
  });
  it('cada columna toma su dato; Llegó dice cuántos y en qué', () => {
    expect(h.filas[0]).toEqual(['REC-20261024-0001', '2026-10-24', '001-002-000123', '123-456-789', 'Camaronera Sol', 'Entero', '12 bines', 1000.5, 990.25, -10.25]);
    expect(h.filas[1][6]).toBe('1 gaveta');
    expect(h.filas[1][8]).toBeNull();
    expect(h.filas[1][9]).toBeNull();
  });
  it('los pesos van como números con 2 decimales y la fecha como fecha', () => {
    expect(h.columnas.filter((c) => c.formato === 'dec2').map((c) => c.titulo)).toEqual(['Libras reportadas', 'Libras planta', 'Diferencia']);
    expect(h.columnas[1].formato).toBe('fecha');
  });
});

describe('exportación a Excel', () => {
  it('genera las 6 hojas con sus columnas', () => {
    const h = hojasExcel(datos);
    expect(h.map((x) => x.nombre)).toEqual(['Recepciones', 'Gavetas', 'Temperaturas', 'Almacenamiento', 'Fotos', 'Consolidado']);
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
    expect(Object.keys(unzipSync(construirExcel(datos)))).toContain('xl/worksheets/sheet6.xml');
  });
  it('nombre del archivo con hora de Ecuador', () => {
    expect(nombreArchivoExcel(new Date('2026-10-25T04:16:00Z'))).toBe('recepciones_2026-10-24_2316.xlsx');
  });
});
