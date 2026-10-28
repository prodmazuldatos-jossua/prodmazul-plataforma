import { describe, expect, it } from 'vitest';
import { aApiError, ApiError, esErrorDeRed, mensajeDe } from './errores';

describe('errores', () => {
  it('interpreta el formato CODIGO|mensaje de la base de datos', () => {
    const e = aApiError({ message: 'E_PERMISO|No tienes permiso para realizar esta acción.' });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.codigo).toBe('E_PERMISO');
    expect(e.message).toBe('No tienes permiso para realizar esta acción.');
  });
  it('detecta errores de red', () => {
    expect(esErrorDeRed(new TypeError('Failed to fetch'))).toBe(true);
    expect(aApiError(new TypeError('Failed to fetch')).codigo).toBe('E_RED');
  });
  it('trata un tiempo de espera agotado como falta de conexión', () => {
    expect(esErrorDeRed({ message: 'TimeoutError: signal timed out' })).toBe(true);
    expect(aApiError({ message: 'AbortError: The user aborted a request.' }).codigo).toBe('E_RED');
  });
  it('traduce problemas de sesión', () => {
    expect(aApiError({ message: 'JWT expired' }).codigo).toBe('E_SESION');
  });
  it('no muestra detalles técnicos desconocidos', () => {
    expect(mensajeDe({ message: 'relation "x" does not exist' })).toBe('Ocurrió un error inesperado. Intenta de nuevo.');
  });
});

describe('mensajes sin jerga técnica', () => {
  it('oculta textos de infraestructura', () => {
    expect(aApiError(new Error('E_ESTADO|La foto ya fue purgada de Supabase; su única copia está en Drive.')).message).not.toMatch(/supabase/i);
    expect(aApiError(new Error('E_CONFIG|Falta el secreto «x» en Vault.')).message).not.toMatch(/vault|secreto/i);
    expect(aApiError(new Error('E_VALIDACION|El peso es obligatorio.')).message).toBe('El peso es obligatorio.');
  });
});
