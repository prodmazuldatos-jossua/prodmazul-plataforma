import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { matrizQr, textoQrFirma } from './qr';
import { ALTO_IMG, ANCHO_IMG, fechaCorta, geometriaQr, nombreArchivoBin, textoLibras, textoQrBin } from './qrBin';

/** Convierte la matriz en píxeles (con borde blanco) y la lee como lo haría un lector de QR. */
function leer(m: boolean[][], modulo = 6, borde = 4): string | null {
  const n = m.length, lado = (n + 2 * borde) * modulo;
  const datos = new Uint8ClampedArray(lado * lado * 4).fill(255);
  m.forEach((fila, f) => fila.forEach((osc, c) => {
    if (!osc) return;
    for (let y = 0; y < modulo; y++) for (let x = 0; x < modulo; x++) {
      const i = (((f + borde) * modulo + y) * lado + (c + borde) * modulo + x) * 4;
      datos[i] = datos[i + 1] = datos[i + 2] = 0;
    }
  }));
  return jsQR(datos, lado, lado)?.data ?? null;
}

const datos = { lote: '123-456-789', fecha: '2026-10-26', guia: 'G-0042', librasPlanta: 990.25, proveedor: 'Camaronera Ñandú, S.A.', especie: 'Entero' };

describe('QR de la firma del PDF', () => {
  it('lleva el lote y el nombre y se puede leer', () => {
    const t = textoQrFirma('123-456-789', 'MISAEL VLADIMIR FERNÁNDEZ CORREA');
    expect(leer(matrizQr(t))).toBe(t);
    expect(t).toContain('123-456-789');
    expect(t).toContain('FERNÁNDEZ');
  });
});

describe('QR de cada bin', () => {
  it('trae Lote, Fecha, Guía, Libras planta, Proveedor y Especie', () => {
    const t = textoQrBin(datos);
    expect(t.split('\n')).toEqual(['Lote: 123-456-789', 'Fecha: 26/10/2026', 'Guía: G-0042', 'Libras planta: 990.25 lb', 'Proveedor: Camaronera Ñandú, S.A.', 'Especie: Entero']);
    expect(leer(matrizQr(t))).toBe(t);
  });
  it('sin libras de planta deja el dato vacío sin romper', () => {
    expect(textoQrBin({ ...datos, librasPlanta: null })).toContain('Libras planta: \n');
  });
  it('la imagen mide 302 × 378 y el QR ocupa casi todo el ancho, centrado', () => {
    expect([ANCHO_IMG, ALTO_IMG]).toEqual([302, 378]);
    const n = matrizQr(textoQrBin(datos)).length;
    const g = geometriaQr(n);
    expect(g.lado).toBeGreaterThan(ANCHO_IMG * 0.75);
    expect(g.x).toBeGreaterThanOrEqual(8);
    expect(g.x + g.lado).toBeLessThanOrEqual(ANCHO_IMG - 8);
    expect(g.y + g.lado).toBeLessThan(ALTO_IMG - 50); // queda espacio abajo para el lote
    expect(g.lado % g.n).toBe(0); // módulos de tamaño entero
  });
  it('formatos auxiliares', () => {
    expect(fechaCorta('2026-01-05')).toBe('05/01/2026');
    expect(textoLibras(1000)).toBe('1000 lb');
    expect(textoLibras(12.5)).toBe('12.5 lb');
    expect(nombreArchivoBin('123-456-789', 'B 1/ñ')).toBe('QR_Lote_123-456-789_Bin_B_1_n.png');
  });
});
