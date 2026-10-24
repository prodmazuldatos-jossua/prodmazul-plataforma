import { describe, expect, it } from 'vitest';
import { formatoFecha, formatoHora, hoyEcuador } from './fechas';

describe('fechas', () => {
  it('da vuelta la fecha ISO', () => { expect(formatoFecha('2026-10-20')).toBe('20/10/2026'); });
  it('tolera vacíos', () => { expect(formatoFecha(null)).toBe(''); expect(formatoHora(undefined)).toBe(''); });
  it('recorta la hora', () => { expect(formatoHora('08:30:00')).toBe('08:30'); });
  it('hoy en Ecuador tiene formato AAAA-MM-DD', () => { expect(hoyEcuador()).toMatch(/^\d{4}-\d{2}-\d{2}$/); });
});
