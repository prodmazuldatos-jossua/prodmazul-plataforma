import { describe, expect, it } from 'vitest';
import {
  celdaCsv, construirCsv, construirTablas, datosGrafico, escalaEje, etiquetaPeriodo, lunesDe, nombreArchivoReporte, rangoAtajo, textoCelda, validarFiltros,
  type RespEspecie, type RespPeriodos, type RespProveedores,
} from './reportes';

const per: RespPeriodos = {
  desde: '2001-03-01', hasta: '2001-03-31', periodo: 'semana', borradores: false,
  filas: [
    { inicio: '2001-02-26', fin: '2001-03-04', parcial: true, recepciones: 2, lotes: 2, libras_planta: 1000, libras_reportadas: 1010, diferencia_lb: -10, diferencia_pct: -0.99 },
    { inicio: '2001-03-05', fin: '2001-03-11', parcial: false, recepciones: 1, lotes: 1, libras_planta: 525, libras_reportadas: 530, diferencia_lb: -5, diferencia_pct: -0.94 },
  ],
  totales: { recepciones: 3, lotes: 3, libras_planta: 1525, libras_reportadas: 1540, diferencia_lb: -15, diferencia_pct: -0.97 },
};
const prov: RespProveedores = {
  desde: '2001-03-01', hasta: '2001-03-31', borradores: false, proveedores_con_recepcion: 2, proveedores_catalogo: 5,
  filas: [
    { proveedor_id: 'a', proveedor: 'A', recepciones: 2, lotes: 2, libras_planta: 875, libras_reportadas: 880, diferencia_lb: -5, porcentaje: 57.38 },
    { proveedor_id: 'b', proveedor: '=B "x"', recepciones: 1, lotes: 1, libras_planta: 650, libras_reportadas: 660, diferencia_lb: -10, porcentaje: 42.62 },
  ],
  totales: { recepciones: 3, lotes: 3, libras_planta: 1525, libras_reportadas: 1540 },
};

describe('fechas', () => {
  it('lunes de la semana', () => { expect(lunesDe('2001-03-05')).toBe('2001-03-05'); expect(lunesDe('2001-03-11')).toBe('2001-03-05'); expect(lunesDe('2026-10-25')).toBe('2026-10-19'); });
  it('atajos', () => {
    expect(rangoAtajo('mes', '2026-10-24')).toEqual({ desde: '2026-10-01', hasta: '2026-10-24' });
    expect(rangoAtajo('mes_anterior', '2026-03-10')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(rangoAtajo('mes_anterior', '2026-01-10')).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' });
    expect(rangoAtajo('30dias', '2026-10-24')).toEqual({ desde: '2026-09-25', hasta: '2026-10-24' });
    expect(rangoAtajo('semana', '2026-10-24')).toEqual({ desde: '2026-10-19', hasta: '2026-10-24' });
  });
});
describe('validación', () => {
  const f = { desde: '2025-01-01', hasta: '2026-12-31', periodo: 'dia' as const, borradores: false };
  it('día limita a 400', () => { expect(validarFiltros(f, 'libras')).toMatch(/400/); expect(validarFiltros({ ...f, periodo: 'mes' }, 'libras')).toBeNull(); });
  it('proveedores ignora el periodo', () => expect(validarFiltros(f, 'proveedores')).toBeNull());
  it('orden y vacío', () => { expect(validarFiltros({ ...f, desde: '2026-05-01', hasta: '2026-04-01' }, 'libras')).toMatch(/posterior/); expect(validarFiltros({ ...f, desde: '' }, 'libras')).toMatch(/fechas/); });
});
describe('etiquetas y formato', () => {
  it('periodos', () => {
    expect(etiquetaPeriodo(per.filas[0], 'semana')).toBe('26/02 al 04/03/2001 *');
    expect(etiquetaPeriodo({ inicio: '2001-03-01', fin: '2001-03-31', parcial: false }, 'mes')).toBe('mar 2001');
  });
  it('kg y signos', () => {
    expect(textoCelda(1525, 'peso', 'lb')).toBe('1,525.00');
    expect(textoCelda(2204.62, 'peso', 'kg')).toBe('1,000.00');
    expect(textoCelda(5, 'pesoConSigno', 'lb')).toBe('+5.00');
    expect(textoCelda(-15, 'pesoConSigno', 'lb')).toBe('-15.00');
    expect(textoCelda(null, 'pct', 'lb')).toBe('—');
    expect(textoCelda(-0.97, 'pct', 'lb')).toBe('-0.97 %');
    expect(textoCelda(54.1, 'pctPlano', 'lb')).toBe('54.10 %');
    expect(textoCelda(54.1, 'pct', 'lb')).toBe('+54.10 %');
  });
});
describe('tablas y archivos coinciden', () => {
  it('libras: totales de la Parte 7', () => {
    const [t] = construirTablas('libras', per, 'semana', 'lb');
    expect(t.totales?.[2]).toBe(1525);
    expect(t.nota).toMatch(/parcial/);
  });
  it('lotes: el total es de lotes distintos', () => expect(construirTablas('lotes', per, 'semana', 'lb')[0].nota).toMatch(/distintos/));
  it('csv en kg', () => {
    const t = construirTablas('libras', per, 'mes', 'kg');
    const csv = construirCsv(t, { titulo: 'T', rango: 'R', estados: 'E', unidad: 'kg', generado: 'G' }, 'kg');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Total,3,691.73,698.53,-6.80,-0.97');
  });
  it('csv protege fórmulas y comillas', () => {
    expect(celdaCsv('=B "x"')).toBe(`"'=B ""x"""`);
    expect(celdaCsv('a,b')).toBe('"a,b"');
    expect(celdaCsv('+1')).toBe("'+1");
    const csv = construirCsv(construirTablas('proveedores', prov, 'mes', 'lb'), { titulo: 'T', rango: 'R', estados: 'E', unidad: 'lb', generado: 'G' }, 'lb');
    expect(csv).toContain(`"'=B ""x"""`);
  });
  it('libras por proveedor suma 100 %', () => {
    const [t] = construirTablas('libras_proveedor', prov, 'mes', 'lb');
    expect(t.totales?.[5]).toBe(100); expect(t.totales?.[2]).toBe(1525);
  });
  it('especie devuelve dos tablas', () => {
    const e: RespEspecie = { desde: 'a', hasta: 'b', borradores: false, filas: [{ proveedor_id: 'a', proveedor: 'A', especie_id: 'x', especie: 'X', recepciones: 1, lotes: 1, libras_planta: 375, libras_reportadas: 380 }], por_especie: [{ especie_id: 'x', especie: 'X', recepciones: 1, lotes: 1, proveedores: 1, libras_planta: 375 }], totales: { recepciones: 1, lotes: 1, proveedores: 1, especies: 1, libras_planta: 375 } };
    expect(construirTablas('especie', e, 'mes', 'lb')).toHaveLength(2);
  });
  it('nombre de archivo', () => expect(nombreArchivoReporte('libras', 'mes', { desde: '2001-03-01', hasta: '2001-03-31' }, 'csv')).toBe('Reporte_Libras_planta_por_periodo_por_mes_2001-03-01_2001-03-31.csv'));
});
describe('gráfico', () => {
  it('top 10 de proveedores ordenado', () => {
    const g = datosGrafico('libras_proveedor', prov, 'mes', 'lb');
    expect(g.horizontal).toBe(true); expect(g.barras[0].etiqueta).toBe('A'); expect(g.barras[0].valor).toBe(875);
  });
  it('eje redondo', () => { expect(escalaEje(1525).tope).toBeGreaterThanOrEqual(1525); expect(escalaEje(0).tope).toBe(1); expect(escalaEje(7).valores[0]).toBe(0); });
});
