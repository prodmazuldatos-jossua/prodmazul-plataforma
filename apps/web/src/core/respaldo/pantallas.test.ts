import { describe, expect, it } from 'vitest';
import { createElement as h, Fragment, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { RespaldoContext, type CtxRespaldo } from './usarRespaldo';
import { AvisoRespaldo, IndicadorRespaldo } from './IndicadorRespaldo';
import PaginaRespaldo from './PaginaRespaldo';
import { nivelActual, textoIndicador, type ResumenRespaldo } from './respaldo';

const T0 = 1_000_000_000_000;
function base(extra: Partial<ResumenRespaldo> = {}): ResumenRespaldo {
  return {
    ahora: '2026-10-26T12:00:00Z', activa: true, nivel: 'ok', alerta: false, motivos: [], limite_horas: 6,
    ultima_sync_ok_en: '2026-10-26T11:50:00Z', segundos_sin_sincronizar: 600, ultimo_intento_en: null,
    pendientes: 0, con_error: 0, agotadas: 0, fotos_sin_respaldo: 0, fotos_mas_antigua_en: null, fotos_con_error: 0, fotos_agotadas: 0,
    purga_activa: false, purga_con_error: 0, purga_agotadas: 0, ultima_corrida: null, ultima_purga: null, problemas: 0, ...extra,
  };
}
function ctx(r: ResumenRespaldo | null, extra: Partial<CtxRespaldo> = {}): CtxRespaldo {
  return {
    resumen: r, recibidoMs: T0, ahoraMs: T0, error: null, cargando: false, recargar: async () => {},
    nivel: r ? nivelActual(r, T0, T0) : null, texto: r ? textoIndicador(r, T0, T0) : '', ...extra,
  };
}
const dibujar = (c: CtxRespaldo, hijo: ReactNode) =>
  renderToString(h(MemoryRouter, null, h(RespaldoContext.Provider, { value: c }, hijo)));
const Indicadores = () => h(Fragment, null, h(IndicadorRespaldo), h(AvisoRespaldo));

describe('indicador y aviso', () => {
  it('muestra «Respaldo: hace 10 minutos» en verde y sin aviso rojo', () => {
    const html = dibujar(ctx(base()), h(Indicadores));
    expect(html).toContain('Respaldo: hace 10 minutos');
    expect(html).toContain('respaldo-ok');
    expect(html).not.toContain('aviso-respaldo');
  });
  it('con más de 6 horas muestra el aviso en rojo con el enlace al detalle', () => {
    const r = base({ alerta: true, nivel: 'alerta', segundos_sin_sincronizar: 7 * 3600, motivos: [{ codigo: 'sync_vieja', texto: 'Hace más de 6 horas que los datos no se respaldan en Google Sheets.' }] });
    const html = dibujar(ctx(r), h(Indicadores));
    expect(html).toContain('respaldo-alerta');
    expect(html).toContain('aviso-respaldo');
    expect(html).toContain('alerta-error');
    expect(html).toContain('Hace más de 6 horas');
    expect(html).toContain('/admin/respaldo');
    expect(html).toContain('hace 7 horas');
  });
  it('con problemas pero sin atraso: chip amarillo y SIN aviso rojo', () => {
    const html = dibujar(ctx(base({ problemas: 2, con_error: 2 })), h(Indicadores));
    expect(html).toContain('respaldo-aviso');
    expect(html).toContain('2 problemas');
    expect(html).not.toContain('aviso-respaldo');
  });
  it('apagado: chip gris y sin aviso', () => {
    const html = dibujar(ctx(base({ activa: false })), h(Indicadores));
    expect(html).toContain('Respaldo: apagado');
    expect(html).toContain('respaldo-apagada');
    expect(html).not.toContain('aviso-respaldo');
  });
  it('sin datos todavía no dibuja nada', () => {
    expect(dibujar(ctx(null), h(Indicadores))).toBe('');
  });
});

describe('pantalla Estado del respaldo', () => {
  it('muestra el estado, las cifras y los botones', () => {
    const html = dibujar(ctx(base({ pendientes: 3, fotos_sin_respaldo: 2 })), h(PaginaRespaldo));
    expect(html).toContain('Estado del respaldo');
    expect(html).toContain('Todo al día');
    expect(html).toContain('hace 10 minutos');
    expect(html).toContain('Respaldar ahora');
    expect(html).toContain('Reintentar errores');
    expect(html).toContain('Cambios por enviar');
    expect(html).toContain('horas sin respaldar');
  });
  it('en rojo explica el motivo', () => {
    const r = base({ alerta: true, segundos_sin_sincronizar: null, ultima_sync_ok_en: null, motivos: [{ codigo: 'sin_sincronizar', texto: 'Todavía no hay ninguna sincronización correcta con Google.' }] });
    const html = dibujar(ctx(r), h(PaginaRespaldo));
    expect(html).toContain('El respaldo no está al día');
    expect(html).toContain('Todavía no hay ninguna sincronización correcta con Google.');
  });
  it('apagado: lo explica y no ofrece respaldar', () => {
    const html = dibujar(ctx(base({ activa: false })), h(PaginaRespaldo));
    expect(html).toContain('El respaldo está apagado');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.{0,700}Respaldar ahora/s);
  });
  it('sin datos y con error de red muestra un mensaje y reintento', () => {
    const html = dibujar(ctx(null, { error: 'No hay conexión con el servidor.' }), h(PaginaRespaldo));
    expect(html).toContain('No se pudo cargar el estado del respaldo');
    expect(html).toContain('Reintentar');
  });
});
