import { describe, expect, it } from 'vitest';
import { explicarError, motivosAlerta, nivelActual, segundosDesde, textoEstadoCorrida, textoHace, textoIndicador, type ResumenRespaldo } from './respaldo';

function resumen(extra: Partial<ResumenRespaldo> = {}): ResumenRespaldo {
  return {
    ahora: '2026-10-26T12:00:00Z', activa: true, nivel: 'ok', alerta: false, motivos: [], limite_horas: 6,
    ultima_sync_ok_en: '2026-10-26T11:50:00Z', segundos_sin_sincronizar: 600, ultimo_intento_en: null,
    pendientes: 0, con_error: 0, agotadas: 0, fotos_sin_respaldo: 0, fotos_mas_antigua_en: null, fotos_con_error: 0, fotos_agotadas: 0,
    purga_activa: false, purga_con_error: 0, purga_agotadas: 0, ultima_corrida: null, ultima_purga: null, problemas: 0, ...extra,
  };
}
const T0 = 1_000_000_000_000;

describe('textoHace', () => {
  it('menos de un minuto', () => { expect(textoHace(0)).toBe('hace menos de 1 minuto'); expect(textoHace(59)).toBe('hace menos de 1 minuto'); });
  it('minutos', () => { expect(textoHace(60)).toBe('hace 1 minuto'); expect(textoHace(300)).toBe('hace 5 minutos'); expect(textoHace(59 * 60 + 59)).toBe('hace 59 minutos'); });
  it('horas', () => { expect(textoHace(3600)).toBe('hace 1 hora'); expect(textoHace(2 * 3600)).toBe('hace 2 horas'); expect(textoHace(2 * 3600 + 15 * 60)).toBe('hace 2 h 15 min'); });
  it('días a partir de 48 horas', () => { expect(textoHace(47 * 3600)).toBe('hace 47 horas'); expect(textoHace(50 * 3600)).toBe('hace 2 días'); });
  it('un valor negativo no rompe', () => { expect(textoHace(-5)).toBe('hace menos de 1 minuto'); });
});

describe('segundosDesde', () => {
  it('suma el tiempo transcurrido desde que llegó el dato', () => { expect(segundosDesde(resumen(), T0, T0 + 120_000)).toBe(720); });
  it('nunca resta (reloj atrasado)', () => { expect(segundosDesde(resumen(), T0, T0 - 5000)).toBe(600); });
  it('sin sincronización devuelve null', () => { expect(segundosDesde(resumen({ segundos_sin_sincronizar: null }), T0, T0)).toBeNull(); });
});

describe('nivelActual', () => {
  it('ok cuando todo va bien', () => { expect(nivelActual(resumen(), T0, T0)).toBe('ok'); });
  it('apagada no da alarma aunque haya pasado mucho', () => { expect(nivelActual(resumen({ activa: false, segundos_sin_sincronizar: 99 * 3600 }), T0, T0)).toBe('apagada'); });
  it('aviso cuando hay problemas pero no rojo', () => { expect(nivelActual(resumen({ problemas: 2 }), T0, T0)).toBe('aviso'); });
  it('rojo cuando el servidor lo dice', () => { expect(nivelActual(resumen({ alerta: true }), T0, T0)).toBe('alerta'); });
  it('rojo si nunca hubo sincronización', () => { expect(nivelActual(resumen({ segundos_sin_sincronizar: null, ultima_sync_ok_en: null }), T0, T0)).toBe('alerta'); });
  it('sin señal: el rojo aparece solo cuando pasan las 6 horas', () => {
    const r = resumen({ segundos_sin_sincronizar: 5 * 3600 + 50 * 60 });
    expect(nivelActual(r, T0, T0)).toBe('ok');
    expect(nivelActual(r, T0, T0 + 5 * 60_000)).toBe('ok');
    expect(nivelActual(r, T0, T0 + 11 * 60_000)).toBe('alerta');
  });
  it('respeta un límite distinto', () => { expect(nivelActual(resumen({ limite_horas: 2, segundos_sin_sincronizar: 3 * 3600 }), T0, T0)).toBe('alerta'); });
});

describe('textoIndicador y motivos', () => {
  it('«Respaldo: hace X minutos»', () => { expect(textoIndicador(resumen(), T0, T0)).toBe('Respaldo: hace 10 minutos'); expect(textoIndicador(resumen(), T0, T0 + 5 * 60_000)).toBe('Respaldo: hace 15 minutos'); });
  it('apagado y sin sincronizar', () => {
    expect(textoIndicador(resumen({ activa: false }), T0, T0)).toBe('Respaldo: apagado');
    expect(textoIndicador(resumen({ segundos_sin_sincronizar: null }), T0, T0)).toBe('Respaldo: sin sincronizar');
  });
  it('los motivos vienen del servidor', () => {
    const r = resumen({ alerta: true, motivos: [{ codigo: 'sync_vieja', texto: 'Hace más de 6 horas…' }] });
    expect(motivosAlerta(r, T0, T0)).toEqual(['Hace más de 6 horas…']);
  });
  it('si el rojo aparece por el paso del tiempo, también se explica', () => {
    const r = resumen({ segundos_sin_sincronizar: 6 * 3600 - 60 });
    expect(motivosAlerta(r, T0, T0)).toEqual([]);
    expect(motivosAlerta(r, T0, T0 + 120_000)[0]).toContain('más de 6 horas');
  });
  it('apagado no tiene motivos', () => { expect(motivosAlerta(resumen({ activa: false, motivos: [{ codigo: 'x', texto: 'y' }] }), T0, T0)).toEqual([]); });
});

describe('explicarError', () => {
  it('papelera', () => { expect(explicarError('Drive no confirmó la copia: El archivo esta en la papelera de Drive.').titulo).toMatch(/papelera/i); });
  it('archivo que no corresponde', () => { expect(explicarError('El archivo de Drive no corresponde a esta foto (la descripcion no coincide).').titulo).toMatch(/no es el de esta foto/i); });
  it('tamaño distinto', () => { expect(explicarError('El archivo de Drive pesa 10 bytes y se esperaban 20').titulo).toMatch(/no pesa lo mismo/i); });
  it('no se pudo abrir', () => { expect(explicarError('No se pudo abrir el archivo en Drive.').titulo).toMatch(/No se encontró/); });
  it('autorización', () => { expect(explicarError('no autorizado').titulo).toMatch(/autorización/i); expect(explicarError('Falta el secreto APPS_SCRIPT_TOKEN en las funciones de Supabase.').titulo).toMatch(/autorización/i); });
  it('tiempo agotado', () => { expect(explicarError('Tiempo agotado: se procesaron 3').titulo).toMatch(/tardó/i); expect(explicarError('El envío no se confirmó a tiempo.').titulo).toMatch(/tardó/i); });
  it('límite de Google', () => { expect(explicarError('Exception: Service invoked too many times').titulo).toMatch(/esperar/i); });
  it('sin conexión / errores 5xx', () => { expect(explicarError('Google respondió 503').titulo).toMatch(/conexión/i); expect(explicarError('Failed to fetch').titulo).toMatch(/conexión/i); });
  it('vacío y desconocido', () => { expect(explicarError(null).titulo).toBe('Sin detalle'); expect(explicarError('algo raro').titulo).toBe('Error sin clasificar'); });
  it('siempre trae una acción', () => { for (const t of [null, '', 'x', 'papelera', 'pesa', 'token']) expect(explicarError(t).ayuda.length).toBeGreaterThan(10); });
});

describe('textoEstadoCorrida', () => {
  it('traduce', () => { expect(textoEstadoCorrida('con_error')).toBe('con error'); expect(textoEstadoCorrida('sin_respuesta')).toBe('sin respuesta'); expect(textoEstadoCorrida('ok')).toBe('correcta'); });
});
