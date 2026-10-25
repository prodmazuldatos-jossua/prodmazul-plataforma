import { describe, expect, it } from 'vitest';
import { distancia, hayCoincidenciaExacta, normalizar, parecidos } from './texto';

describe('normalizar (igual que la base de datos)', () => {
  it('pone mayúsculas, quita tildes y espacios repetidos', () => {
    expect(normalizar('  Camaronera   Árbol ')).toBe('CAMARONERA ARBOL');
    expect(normalizar('Camarón')).toBe('CAMARON');
    expect(normalizar('Ñandú Ü')).toBe('NANDU U');
  });
  it('tolera vacío y nulos', () => { expect(normalizar('')).toBe(''); expect(normalizar(null)).toBe(''); expect(normalizar(undefined)).toBe(''); });
});

describe('distancia', () => {
  it('cuenta cambios de letras', () => {
    expect(distancia('CASA', 'CASA')).toBe(0);
    expect(distancia('CASA', 'CAZA')).toBe(1);
    expect(distancia('CASA', 'CASAS')).toBe(1);
    expect(distancia('', 'ABC')).toBe(3);
    expect(distancia('KITTEN', 'SITTING')).toBe(3);
  });
});

describe('parecidos', () => {
  const lista = ['Camaronera Árbol', 'Pesquera Sur', 'Acuícola del Pacífico'];
  it('detecta un error de digitación', () => {
    expect(parecidos('Camaronera Arbo', lista)).toEqual(['Camaronera Árbol']);
    expect(parecidos('Pesquera Sul', lista)).toEqual(['Pesquera Sur']);
  });
  it('no avisa si es exactamente igual (aunque cambien mayúsculas o tildes)', () => {
    expect(parecidos('CAMARONERA ARBOL', lista)).toEqual([]);
    expect(hayCoincidenciaExacta('camaronera arbol', lista)).toBe(true);
  });
  it('no avisa con textos cortos o muy distintos', () => {
    expect(parecidos('ab', lista)).toEqual([]);
    expect(parecidos('Textiles Norte', lista)).toEqual([]);
  });
  it('avisa si uno contiene al otro', () => { expect(parecidos('Pesquera', lista)).toEqual(['Pesquera Sur']); });
  it('sin coincidencia exacta en lista vacía', () => { expect(hayCoincidenciaExacta('x', [])).toBe(false); });
});
