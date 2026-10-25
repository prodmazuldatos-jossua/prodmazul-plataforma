/** Misma regla que la base de datos (core.normalizar): mayúsculas, sin tildes y sin espacios repetidos. */
export function normalizar(t: string | null | undefined): string {
  return (t ?? '')
    .trim()
    .replace(/[áàäâ]/gi, 'a').replace(/[éèëê]/gi, 'e').replace(/[íìïî]/gi, 'i')
    .replace(/[óòöô]/gi, 'o').replace(/[úùüû]/gi, 'u').replace(/ñ/gi, 'n')
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/** Distancia de edición (cuántas letras hay que cambiar para pasar de una palabra a otra). */
export function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + costo);
    }
    previa = actual;
  }
  return previa[b.length];
}

/**
 * Nombres del catálogo que se parecen a lo escrito pero NO son iguales (posible error de digitación).
 * Se parecen si difieren en pocas letras o si uno contiene al otro.
 */
export function parecidos(escrito: string, nombres: string[]): string[] {
  const n = normalizar(escrito);
  if (n.length < 3) return [];
  const limite = n.length >= 8 ? 2 : 1;
  return nombres.filter((nombre) => {
    const m = normalizar(nombre);
    if (m === n) return false;
    return distancia(n, m) <= limite || (n.length >= 4 && (m.includes(n) || n.includes(m)));
  });
}

export function hayCoincidenciaExacta(escrito: string, nombres: string[]): boolean {
  const n = normalizar(escrito);
  return n !== '' && nombres.some((x) => normalizar(x) === n);
}

/**
 * Autocompletar: primer nombre del catálogo que empieza con lo escrito (sin distinguir mayúsculas ni tildes)
 * y que es más largo que lo escrito. Devuelve null si no hay ninguno.
 */
export function completar(escrito: string, nombres: string[]): string | null {
  const n = normalizar(escrito);
  if (n.length < 2) return null;
  return nombres.find((x) => { const m = normalizar(x); return m.length > n.length && m.startsWith(n); }) ?? null;
}

/** Nombre del catálogo igual a lo escrito (ignorando mayúsculas, tildes y espacios repetidos), con su escritura oficial. */
export function nombreOficial(escrito: string, nombres: string[]): string | null {
  const n = normalizar(escrito);
  return n === '' ? null : nombres.find((x) => normalizar(x) === n) ?? null;
}

/** «5 bines», «1 bin», «12 gavetas», «1 gaveta». */
export function textoCantidad(n: number, tipo: 'bines' | 'gavetas'): string {
  const singular = tipo === 'bines' ? 'bin' : 'gaveta';
  return `${n} ${n === 1 ? singular : tipo}`;
}

/** Etiqueta del módulo en las pantallas: «M01» pasa a «Módulo 1», «M12» a «Módulo 12». */
export function etiquetaModulo(id: string): string {
  const m = /^M0*(\d+)$/i.exec(id.trim());
  return m ? `Módulo ${m[1]}` : id;
}
