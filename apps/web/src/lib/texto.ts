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
