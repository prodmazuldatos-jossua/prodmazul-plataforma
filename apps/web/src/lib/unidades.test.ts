import { describe, expect, it } from 'vitest';
import { FACTOR_LB_KG, kgALb, lbAKg } from './unidades';

describe('conversión de unidades', () => {
  it('usa el factor 2,20462', () => { expect(FACTOR_LB_KG).toBe(2.20462); });
  it('convierte libras a kilos', () => { expect(lbAKg(2.20462)).toBeCloseTo(1, 6); expect(lbAKg(100)).toBeCloseTo(45.359, 2); });
  it('convierte kilos a libras', () => { expect(kgALb(1)).toBeCloseTo(2.20462, 6); expect(kgALb(10)).toBeCloseTo(22.0462, 4); });
  it('ida y vuelta sin pérdida visible', () => {
    for (const lb of [0.5, 40, 123.45, 1000]) expect(kgALb(lbAKg(lb))).toBeCloseTo(lb, 6);
  });
  it('10 kg guardados con 2 decimales se muestran como 10 kg', () => {
    const guardado = Math.round(kgALb(10) * 100) / 100; // 22,05 lb
    expect(Math.round(lbAKg(guardado) * 100) / 100).toBe(10);
  });
});
