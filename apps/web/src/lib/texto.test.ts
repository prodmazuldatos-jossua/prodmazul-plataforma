import { describe, expect, it } from 'vitest';
import { completar, distancia, etiquetaModulo, hayCoincidenciaExacta, nombreOficial, normalizar, parecidos, textoCantidad } from './texto';

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

describe('autocompletar', () => {
  const n = ['Camaronera Árbol', 'Pesquera Sur', 'Pesquera Norte'];
  it('completa con el primer nombre que empieza igual, sin importar mayúsculas ni tildes', () => {
    expect(completar('cam', n)).toBe('Camaronera Árbol');
    expect(completar('CAMARONERA AR', n)).toBe('Camaronera Árbol');
    expect(completar('pesq', n)).toBe('Pesquera Sur');
  });
  it('no completa si ya está completo, si no coincide o si es muy corto', () => {
    expect(completar('Pesquera Sur', n)).toBeNull();
    expect(completar('Xyz', n)).toBeNull();
    expect(completar('c', n)).toBeNull();
  });
  it('nombreOficial devuelve la escritura guardada', () => {
    expect(nombreOficial('camaronera arbol', n)).toBe('Camaronera Árbol');
    expect(nombreOficial('otro', n)).toBeNull();
  });
});

describe('textoCantidad', () => {
  it('singular y plural de bines y gavetas', () => {
    expect(textoCantidad(5, 'bines')).toBe('5 bines');
    expect(textoCantidad(1, 'bines')).toBe('1 bin');
    expect(textoCantidad(12, 'gavetas')).toBe('12 gavetas');
    expect(textoCantidad(1, 'gavetas')).toBe('1 gaveta');
  });
});

describe('etiquetaModulo', () => {
  it('cambia el código por «Módulo N»', () => {
    expect(etiquetaModulo('M01')).toBe('Módulo 1');
    expect(etiquetaModulo('M2')).toBe('Módulo 2');
    expect(etiquetaModulo('M16')).toBe('Módulo 16');
    expect(etiquetaModulo('Otro')).toBe('Otro');
  });
});
