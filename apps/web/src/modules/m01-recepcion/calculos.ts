/** Cálculos del formulario. Redondeo «half away from zero» a 2 decimales, igual que la base de datos. */
export function redondear(x: number, decimales = 2): number {
  const f = 10 ** decimales;
  return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f;
}

/** Libras de planta menos libras reportadas. Negativo = faltante. */
export function diferenciaLb(reportadas: number | null, planta: number | null): number | null {
  if (reportadas === null || planta === null) return null;
  return redondear(planta - reportadas);
}

/** Diferencia en % sobre lo reportado. Sin reportadas (o 0) no hay porcentaje. */
export function diferenciaPct(reportadas: number | null, planta: number | null): number | null {
  if (reportadas === null || planta === null || reportadas <= 0) return null;
  return redondear(((planta - reportadas) / reportadas) * 100);
}

function aMinutos(h: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(h);
  if (!m) return null;
  const hh = Number(m[1]); const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/** Minutos entre inicio y fin de descarga. Sin una de las horas, o con fin antes que inicio, no hay duración. */
export function duracionMin(inicio: string, fin: string): number | null {
  const a = aMinutos(inicio); const b = aMinutos(fin);
  if (a === null || b === null || b < a) return null;
  return b - a;
}

export function textoDuracion(min: number | null): string {
  if (min === null) return '';
  const h = Math.floor(min / 60); const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Peso promedio = promedio de los pesos de todas las gavetas registradas. */
export function pesoPromedio(pesos: number[]): number | null {
  if (pesos.length === 0) return null;
  return redondear(pesos.reduce((s, p) => s + p, 0) / pesos.length);
}
