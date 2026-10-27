import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { ItemCatalogo } from './api';
import {
  FILTROS_VACIOS, errorFiltros, errorMotivo, esIgual, etiquetaAccion, etiquetaModulo, gruposParecidos, hayFiltros,
  paramsAuditoria, resumenDetalle, textoRango, textoUnion, totalPaginas, validarParametro,
} from './administracion';
import PaginaConfiguracion from './PaginaConfiguracion';
import PaginaAuditoria from './PaginaAuditoria';
import PaginaLotes from './PaginaLotes';
import PaginaCatalogo from './PaginaCatalogo';

const ent = { tipo: 'entero' as const, min: 7, max: 3650 };
const dec = { tipo: 'decimal' as const, min: 2.2, max: 2.21 };
const rx = { tipo: 'regex' as const };

describe('validarParametro', () => {
  it('acepta un entero dentro del rango, con espacios', () => {
    expect(validarParametro(ent, ' 90 ')).toEqual({ ok: true, valor: 90 });
    expect(validarParametro(ent, '7')).toEqual({ ok: true, valor: 7 });
    expect(validarParametro(ent, '3650')).toEqual({ ok: true, valor: 3650 });
  });
  it('rechaza fuera de rango, con decimales o no numérico', () => {
    for (const t of ['6', '3651', '-5']) expect(validarParametro(ent, t).ok).toBe(false);
    expect(validarParametro(ent, '30.5')).toEqual({ ok: false, error: 'Debe ser un número entero, sin decimales.' });
    for (const t of ['', 'abc', '1e3', '12 días']) expect(validarParametro(ent, t)).toEqual({ ok: false, error: 'Escribe un número.' });
  });
  it('decimales: coma o punto, máximo 5 decimales, rango', () => {
    expect(validarParametro(dec, '2,20462')).toEqual({ ok: true, valor: 2.20462 });
    expect(validarParametro(dec, '2.2')).toEqual({ ok: true, valor: 2.2 });
    expect(validarParametro(dec, '2.2046212')).toEqual({ ok: false, error: 'Puede tener como máximo 5 decimales.' });
    expect(validarParametro(dec, '3').ok).toBe(false);
    expect(validarParametro(dec, '2.19').ok).toBe(false);
  });
  it('formato de lote: ^…$, expresión válida, no acepta vacío', () => {
    expect(validarParametro(rx, '^[0-9]{3}$').ok).toBe(true);
    expect(validarParametro(rx, 'abc').ok).toBe(false);
    expect(validarParametro(rx, '^(').ok).toBe(false);
    expect(validarParametro(rx, '^[0-9]*$')).toEqual({ ok: false, error: 'El formato no puede aceptar un lote vacío.' });
    expect(validarParametro(rx, '')).toEqual({ ok: false, error: 'El formato no puede estar vacío.' });
    expect(validarParametro(rx, '^' + 'a'.repeat(200) + '$').ok).toBe(false);
  });
  it('esIgual compara como texto', () => { expect(esIgual(90, '90')).toBe(true); expect(esIgual(2.2, 2.20462)).toBe(false); });
});

describe('motivo', () => {
  it('entre 5 y 500 caracteres, sin contar espacios de los lados', () => {
    expect(errorMotivo('   abc  ')).toMatch(/al menos 5/);
    expect(errorMotivo('abcde')).toBeNull();
    expect(errorMotivo('x'.repeat(501))).toMatch(/500/);
  });
});

describe('textos de la auditoría', () => {
  it('etiquetas en español y respaldo para acciones desconocidas', () => {
    expect(etiquetaAccion('reabrir_lote')).toBe('Reabrió un lote');
    expect(etiquetaAccion('cambiar_config')).toBe('Cambió un parámetro');
    expect(etiquetaAccion('algo_nuevo_raro')).toBe('algo nuevo raro');
    expect(etiquetaModulo('M01')).toBe('Recepción');
    expect(etiquetaModulo('CORE')).toBe('Sistema');
    expect(etiquetaModulo(null)).toBe('—');
  });
  it('resumen de configuración, lotes y uniones', () => {
    expect(resumenDetalle('cambiar_config', 'dias_retencion_fotos', { antes: 60, despues: 90 })).toBe('dias_retencion_fotos: de 60 a 90.');
    expect(resumenDetalle('reabrir_lote', '981-981-981', { motivo: 'Llegó otro camión', camiones: 2 })).toBe('Lote 981-981-981 · 2 camión(es) · motivo: Llegó otro camión');
    expect(resumenDetalle('unir_proveedor', 'x', { origen_nombre: 'A S.A.', destino_nombre: 'A', recepciones: 3, lotes: 1, motivo: 'mismo' })).toContain('«A S.A.» → «A»');
  });
  it('el resumen genérico nunca muestra claves y omite objetos', () => {
    const t = resumenDetalle('otra', null, { clave: 'secreto', password: 'p', contraseña: 'q', ok: 1, anidado: { a: 1 } });
    expect(t).toBe('ok: 1');
    expect(t).not.toMatch(/secreto/);
  });
});

describe('filtros y paginación', () => {
  it('solo envía los filtros con valor', () => {
    expect(paramsAuditoria(FILTROS_VACIOS, 1)).toEqual({ pagina: 1, por_pagina: 30 });
    expect(paramsAuditoria({ ...FILTROS_VACIOS, desde: '2026-10-01', accion: ' cambiar_config ', texto: '  ' }, 2))
      .toEqual({ pagina: 2, por_pagina: 30, desde: '2026-10-01', accion: 'cambiar_config' });
  });
  it('detecta filtros activos y fechas al revés', () => {
    expect(hayFiltros(FILTROS_VACIOS)).toBe(false);
    expect(hayFiltros({ ...FILTROS_VACIOS, usuario: 'u' })).toBe(true);
    expect(errorFiltros({ ...FILTROS_VACIOS, desde: '2026-10-05', hasta: '2026-10-01' })).toMatch(/no puede ser posterior/);
    expect(errorFiltros({ ...FILTROS_VACIOS, desde: '2026-10-01', hasta: '2026-10-01' })).toBeNull();
    expect(errorFiltros({ ...FILTROS_VACIOS, desde: '2026-10-05' })).toBeNull();
  });
  it('rango y número de páginas', () => {
    expect(textoRango(0, 1, 30)).toBe('Sin resultados');
    expect(textoRango(75, 1, 30)).toBe('1–30 de 75');
    expect(textoRango(75, 3, 30)).toBe('61–75 de 75');
    expect(totalPaginas(0, 30)).toBe(1); expect(totalPaginas(31, 30)).toBe(2); expect(totalPaginas(60, 30)).toBe(2);
  });
});

const it_ = (id: string, nombre: string, grupo: string | null, rec = 1): ItemCatalogo =>
  ({ id, nombre, activo: true, recepciones: rec, lotes: 1, ultima_recepcion: null, parecidos: grupo ? 2 : 1, grupo });
describe('catálogo', () => {
  it('agrupa solo los nombres parecidos', () => {
    const g = gruposParecidos([it_('1', 'Sol', 'SOL'), it_('2', 'Sol S.A.', 'SOL'), it_('3', 'Otra', null), it_('4', 'Mar', 'MAR')]);
    expect(g).toHaveLength(1); expect(g[0].map((i) => i.id)).toEqual(['1', '2']);
  });
  it('la confirmación explica qué pasa y que no se deshace', () => {
    const t = textoUnion('proveedores', it_('2', 'Sol S.A.', 'SOL', 4), it_('1', 'Sol', 'SOL'));
    expect(t).toContain('«Sol S.A.» (4 recepciones, 1 lotes) se unirá a «Sol»');
    expect(t).toContain('no se puede deshacer'); expect(t).toContain('El proveedor «Sol S.A.» dejará');
    expect(textoUnion('especies', it_('2', 'A.', null), it_('1', 'A', null))).toContain('La especie «A.» dejará');
  });
});

describe('pantallas (primer dibujo)', () => {
  const dibujar = (c: Parameters<typeof h>[0]) => renderToString(h(MemoryRouter, null, h(c as never)));
  it('configuración, lotes y catálogo arrancan con su título y «Cargando»', () => {
    expect(dibujar(PaginaConfiguracion)).toContain('Configuración');
    const l = dibujar(PaginaLotes);
    expect(l).toContain('Lotes'); expect(l).toContain('aria-selected="true"'); expect(l).toContain('Cerrados');
    const c = dibujar(PaginaCatalogo);
    expect(c).toContain('Catálogo'); expect(c).toContain('Proveedores'); expect(c).toContain('Mostrar solo nombres parecidos');
  });
  it('auditoría muestra los seis filtros y el botón Buscar', () => {
    const a = dibujar(PaginaAuditoria);
    for (const t of ['Desde', 'Hasta', 'Usuario', 'Módulo', 'Acción', 'Buscar']) expect(a).toContain(t);
  });
});
