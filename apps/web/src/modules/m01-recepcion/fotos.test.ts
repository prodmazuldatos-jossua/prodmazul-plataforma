import { describe, expect, it } from 'vitest';
import { MAX_LADO_PX, cuposLibres, dimensionesDestino, nombreComprimido, pasosCompresion, textoTamano } from './fotos';

describe('dimensionesDestino', () => {
  it('reduce una foto horizontal grande: el lado mayor queda en 1600', () => {
    expect(dimensionesDestino(4000, 3000)).toEqual({ ancho: 1600, alto: 1200 });
  });
  it('reduce una foto vertical', () => {
    expect(dimensionesDestino(3000, 4000)).toEqual({ ancho: 1200, alto: 1600 });
  });
  it('no agranda una foto pequeña', () => {
    expect(dimensionesDestino(800, 600)).toEqual({ ancho: 800, alto: 600 });
  });
  it('una foto justo de 1600 queda igual', () => {
    expect(dimensionesDestino(1600, 900)).toEqual({ ancho: 1600, alto: 900 });
  });
  it('nunca da cero', () => {
    expect(dimensionesDestino(10000, 1).alto).toBe(1);
    expect(MAX_LADO_PX).toBe(1600);
  });
});

describe('pasosCompresion', () => {
  const p = pasosCompresion();
  it('empieza con buena calidad y tamaño completo', () => {
    expect(p[0]).toEqual({ factor: 1, calidad: 0.8 });
  });
  it('termina en el paso más pequeño y de menor calidad', () => {
    expect(p[p.length - 1]).toEqual({ factor: 0.4, calidad: 0.5 });
  });
  it('baja primero la calidad y luego el tamaño, sin repetir', () => {
    expect(p.slice(0, 4).every((x) => x.factor === 1)).toBe(true);
    expect(new Set(p.map((x) => `${x.factor}-${x.calidad}`)).size).toBe(p.length);
  });
});

describe('nombreComprimido', () => {
  it('quita la ruta y cambia la extensión a .jpg', () => {
    expect(nombreComprimido('C:\\fotos\\IMG_0001.PNG')).toBe('IMG_0001.jpg');
  });
  it('quita tildes y caracteres raros', () => {
    expect(nombreComprimido('Camarón grande #1.jpeg')).toBe('Camaron_grande_1.jpg');
  });
  it('sin nombre usa «foto»', () => {
    expect(nombreComprimido('')).toBe('foto.jpg');
    expect(nombreComprimido('...png')).toBe('foto.jpg');
  });
  it('acorta nombres larguísimos', () => {
    expect(nombreComprimido('a'.repeat(300) + '.jpg').length).toBeLessThanOrEqual(64);
  });
});

describe('cuposLibres', () => {
  it('descuenta guardadas y pendientes', () => {
    expect(cuposLibres(5, 2, 1)).toBe(2);
    expect(cuposLibres(5, 5, 0)).toBe(0);
  });
  it('nunca es negativo', () => {
    expect(cuposLibres(5, 4, 3)).toBe(0);
  });
});

describe('textoTamano', () => {
  it('muestra KB o MB', () => {
    expect(textoTamano(300 * 1024)).toBe('300 KB');
    expect(textoTamano(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(textoTamano(10)).toBe('1 KB');
  });
});
