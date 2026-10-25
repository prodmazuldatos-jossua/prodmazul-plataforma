import { describe, expect, it } from 'vitest';
import { promedioBloque, totalLibrasAprox, totalPesos, diferenciaLb, diferenciaPct, duracionMin, pesoPromedio, redondear, textoDuracion } from './calculos';

describe('redondear', () => {
  it('redondea a 2 decimales como la base de datos', () => {
    expect(redondear(1.005)).toBe(1.01);
    expect(redondear(-1.005)).toBe(-1.01);
    expect(redondear(2.675)).toBe(2.68);
    expect(redondear(-0.5, 0)).toBe(-1);
    expect(redondear(0)).toBe(0);
  });
});

describe('diferencia', () => {
  it('libras de planta menos reportadas', () => {
    expect(diferenciaLb(1000, 990)).toBe(-10);
    expect(diferenciaLb(1000, 1010.5)).toBe(10.5);
    expect(diferenciaLb(null, 990)).toBeNull();
    expect(diferenciaLb(1000, null)).toBeNull();
  });
  it('porcentaje sobre lo reportado, con 2 decimales', () => {
    expect(diferenciaPct(1000, 990)).toBe(-1);
    expect(diferenciaPct(3, 2)).toBe(-33.33);
    expect(diferenciaPct(1000, 1001)).toBe(0.1);
  });
  it('sin reportadas válidas no hay porcentaje', () => {
    expect(diferenciaPct(0, 5)).toBeNull();
    expect(diferenciaPct(null, 5)).toBeNull();
    expect(diferenciaPct(5, null)).toBeNull();
  });
  it('evita el error clásico de decimales flotantes', () => { expect(diferenciaLb(0.3, 0.1)).toBe(-0.2); });
});

describe('duración de descarga', () => {
  it('minutos entre inicio y fin', () => {
    expect(duracionMin('08:00', '09:30')).toBe(90);
    expect(duracionMin('08:00:00', '08:45:00')).toBe(45);
    expect(duracionMin('08:00', '08:00')).toBe(0);
  });
  it('sin una hora, con hora inválida o con fin antes que inicio, no hay duración', () => {
    expect(duracionMin('', '09:30')).toBeNull();
    expect(duracionMin('08:00', '')).toBeNull();
    expect(duracionMin('10:00', '09:00')).toBeNull();
    expect(duracionMin('25:00', '26:00')).toBeNull();
  });
  it('texto legible', () => {
    expect(textoDuracion(90)).toBe('1 h 30 min');
    expect(textoDuracion(45)).toBe('45 min');
    expect(textoDuracion(120)).toBe('2 h');
    expect(textoDuracion(null)).toBe('');
  });
});

describe('peso promedio', () => {
  it('promedio de las gavetas', () => {
    expect(pesoPromedio([100, 110, 120])).toBe(110);
    expect(pesoPromedio([10, 20, 25])).toBe(18.33);
  });
  it('sin gavetas no hay promedio', () => { expect(pesoPromedio([])).toBeNull(); });
});

describe('bloques de gavetas', () => {
  const g = Array.from({ length: 30 }, () => null as number | null);
  g[0] = 50; g[1] = 60; g[10] = 70; g[29] = 10;
  it('promedio por bloque de 10', () => {
    expect(promedioBloque(g, 0)).toBe(55);
    expect(promedioBloque(g, 1)).toBe(70);
    expect(promedioBloque(g, 2)).toBe(10);
  });
  it('un bloque vacío no tiene promedio', () => { expect(promedioBloque(Array.from({ length: 30 }, () => null), 0)).toBeNull(); });
  it('suma los pesos presentes', () => { expect(totalPesos(g)).toBe(190); });
  it('suma las libras aproximadas de almacenamiento', () => {
    const f = (l: number | null) => ({ num_bin: 'B', sellos_recepcion: '', sellos_almacenamiento: '', temperatura_c: null, libras_aprox: l });
    expect(totalLibrasAprox([f(100), f(null), f(50.5)])).toBe(150.5);
  });
});
