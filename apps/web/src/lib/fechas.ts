/** Fecha de hoy en Ecuador (AAAA-MM-DD), sin depender de la zona del dispositivo. */
export function hoyEcuador(): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date());
}

export function formatoFecha(iso: string | null | undefined): string {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function formatoHora(h: string | null | undefined): string {
  return h ? h.slice(0, 5) : '';
}

export function formatoFechaHora(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}
