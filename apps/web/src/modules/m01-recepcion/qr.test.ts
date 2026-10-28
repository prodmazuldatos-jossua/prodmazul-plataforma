import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { matrizQr, textoQrFirma } from './qr';
import { ALTO_IMG, ANCHO_IMG, geometriaQr, nombreArchivoBin, textoQrBin, textoSeguroQr } from './qrBin';

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

const datos = { lote: '123-456-789', guia: 'G-0042', proveedor: 'Camaronera Ñandú, S.A.', especie: 'Entero' };

describe('QR de la firma del PDF', () => {
  it('lleva el lote y el nombre y se puede leer', () => {
    const t = textoQrFirma('123-456-789', 'MISAEL VLADIMIR FERNÁNDEZ CORREA');
    expect(leer(matrizQr(t))).toBe(t);
    expect(t).toContain('123-456-789');
    expect(t).toContain('FERNÁNDEZ');
  });
});

describe('QR de cada bin', () => {
  it('trae Lote, Proveedor, Especie y Guía, y se puede leer', () => {
    const t = textoQrBin(datos);
    expect(t.split('\n')).toEqual(['Lote: 123-456-789', 'Proveedor: Camaronera Nandu, S.A.', 'Especie: Entero', 'Guia: G-0042']);
    expect(leer(matrizQr(t))).toBe(t);
  });
  it('el texto es solo ASCII (sin tildes ni ñ) para que lo lea cualquier lector', () => {
    const t = textoQrBin({ ...datos, proveedor: 'Piscícola Ñuñoa «Sol» N° 5', especie: 'Camarón ✓' });
    expect(/^[\x20-\x7E\n]*$/.test(t)).toBe(true);
    expect(t).toContain('Proveedor: Piscicola Nunoa Sol N 5');
  });
  it('los datos largos se recortan para que el QR siga siendo pequeño y legible', () => {
    expect(textoSeguroQr('A'.repeat(200), 50)).toHaveLength(50);
    const largo = textoQrBin({ lote: '123-456-789', guia: '001-002-' + '9'.repeat(40), proveedor: 'P'.repeat(120), especie: 'E'.repeat(80) });
    expect(matrizQr(largo).length).toBeLessThanOrEqual(53); // versión 9 como máximo
  });
  it('un caso típico da un QR chico: módulos de 6 px o más', () => {
    const n = matrizQr(textoQrBin(datos)).length;
    expect(n).toBeLessThanOrEqual(41);
    expect(geometriaQr(n).modulo).toBeGreaterThanOrEqual(6);
  });
  it('la imagen mide 302 × 378, el QR ocupa casi todo el ancho y deja el borde blanco de 4 módulos', () => {
    expect([ANCHO_IMG, ALTO_IMG]).toEqual([302, 378]);
    for (const texto of [textoQrBin(datos), textoQrBin({ lote: '123-456-789', guia: '9'.repeat(30), proveedor: 'P'.repeat(50), especie: 'E'.repeat(30) })]) {
      const n = matrizQr(texto).length;
      const g = geometriaQr(n);
      expect(g.lado).toBeGreaterThan(ANCHO_IMG * 0.7);
      expect(g.x).toBeGreaterThanOrEqual(4 * g.modulo);
      expect(g.x + g.lado + 4 * g.modulo).toBeLessThanOrEqual(ANCHO_IMG);
      expect(g.y).toBeGreaterThanOrEqual(4 * g.modulo);
      expect(g.y + g.lado).toBeLessThan(ALTO_IMG - 50); // queda espacio abajo para el lote
      expect(g.lado % g.n).toBe(0); // módulos de tamaño entero
    }
  });
  it('el nombre del archivo es seguro', () => {
    expect(nombreArchivoBin('123-456-789', 'B 1/ñ')).toBe('QR_Lote_123-456-789_Bin_B_1_n.png');
  });
});
