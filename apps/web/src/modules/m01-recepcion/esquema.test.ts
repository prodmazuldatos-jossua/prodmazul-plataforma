import { describe, expect, it } from 'vitest';
import { aPayload, loteValido, validarRecepcion, type ContextoValidacion } from './esquema';
import { FORMATO_LOTE_POR_DEFECTO, type FormRecepcion } from './tipos';

const ctx = (extra: Partial<ContextoValidacion> = {}): ContextoValidacion =>
  ({ formatoLote: FORMATO_LOTE_POR_DEFECTO, hoy: '2026-10-24', cerrando: false, loteExiste: false, ...extra });

const base = (extra: Partial<FormRecepcion> = {}): FormRecepcion => ({
  fecha_llegada: '2026-10-24', placa_vehiculo: '', lote_id: '123-456-789', proveedor: 'Prov', especie: 'Camarón', piscina: '',
  guia_remision: 'G-1', num_gavetas_bines: '3', libras_reportadas: 1000, libras_planta: 990,
  hora_inicio_descarga: '08:00', hora_fin_descarga: '09:00', observacion: '', gavetas: [], temperaturas: [], almacenamiento: [], ...extra,
});

describe('formato del lote', () => {
  it('acepta 3 grupos de 3 números, o 3 números y una letra', () => {
    for (const l of ['123-456-789', '123-456A-789', 'A123-456-789', '123A-456B-789C', ' 123-456-789 ', '123-456-789a']) expect(loteValido(l)).toBe(true);
  });
  it('rechaza lo demás', () => {
    for (const l of ['12-34', '123-456', '123-456-7890', '123456789', 'ABC-DEF-GHI', '123-456-789-000', '']) expect(loteValido(l)).toBe(false);
  });
  it('una expresión inválida no rompe la pantalla', () => { expect(loteValido('123', '(')).toBe(false); });
});

describe('validarRecepcion (borrador)', () => {
  it('un formulario correcto no tiene errores', () => { expect(validarRecepcion(base(), ctx())).toEqual({}); });
  it('fecha obligatoria, válida y no futura', () => {
    expect(validarRecepcion(base({ fecha_llegada: '' }), ctx()).fecha_llegada).toMatch(/obligatoria/);
    expect(validarRecepcion(base({ fecha_llegada: '24/10/2026' }), ctx()).fecha_llegada).toMatch(/no es válida/);
    expect(validarRecepcion(base({ fecha_llegada: '2026-10-25' }), ctx()).fecha_llegada).toMatch(/futura/);
    expect(validarRecepcion(base({ fecha_llegada: '2026-10-24' }), ctx()).fecha_llegada).toBeUndefined();
  });
  it('guía obligatoria (los espacios no cuentan)', () => { expect(validarRecepcion(base({ guia_remision: '   ' }), ctx()).guia_remision).toBeDefined(); });
  it('lote obligatorio y con formato', () => {
    expect(validarRecepcion(base({ lote_id: '' }), ctx()).lote_id).toMatch(/obligatorio/);
    expect(validarRecepcion(base({ lote_id: '12-34' }), ctx()).lote_id).toMatch(/formato/);
  });
  it('especie siempre obligatoria; proveedor solo si el lote es nuevo', () => {
    expect(validarRecepcion(base({ especie: '' }), ctx()).especie).toBeDefined();
    expect(validarRecepcion(base({ proveedor: '' }), ctx({ loteExiste: false })).proveedor).toBeDefined();
    expect(validarRecepcion(base({ proveedor: '' }), ctx({ loteExiste: null })).proveedor).toBeDefined();
    expect(validarRecepcion(base({ proveedor: '' }), ctx({ loteExiste: true })).proveedor).toBeUndefined();
  });
  it('número de gavetas: entero de 1 o más', () => {
    for (const v of ['', '0', '-2', '2.5', 'abc']) expect(validarRecepcion(base({ num_gavetas_bines: v }), ctx()).num_gavetas_bines).toBeDefined();
    expect(validarRecepcion(base({ num_gavetas_bines: '1' }), ctx()).num_gavetas_bines).toBeUndefined();
  });
  it('libras mayores que cero cuando se escriben', () => {
    expect(validarRecepcion(base({ libras_reportadas: 0 }), ctx()).libras_reportadas).toBeDefined();
    expect(validarRecepcion(base({ libras_planta: -5 }), ctx()).libras_planta).toBeDefined();
  });
  it('un borrador puede no tener libras', () => {
    expect(validarRecepcion(base({ libras_reportadas: null, libras_planta: null }), ctx())).toEqual({});
  });
  it('la hora de fin no puede ser anterior a la de inicio', () => {
    expect(validarRecepcion(base({ hora_inicio_descarga: '10:00', hora_fin_descarga: '09:00' }), ctx()).hora_fin_descarga).toBeDefined();
    expect(validarRecepcion(base({ hora_inicio_descarga: '', hora_fin_descarga: '09:00' }), ctx()).hora_fin_descarga).toBeUndefined();
  });
  it('observación de hasta 2000 caracteres', () => {
    expect(validarRecepcion(base({ observacion: 'x'.repeat(2001) }), ctx()).observacion).toBeDefined();
    expect(validarRecepcion(base({ observacion: 'x'.repeat(2000) }), ctx()).observacion).toBeUndefined();
  });
});

describe('validarRecepcion (cerrar)', () => {
  it('exige libras reportadas, libras de planta y al menos una gaveta', () => {
    const e = validarRecepcion(base({ libras_reportadas: null, libras_planta: null }), ctx({ cerrando: true }));
    expect(e.libras_reportadas).toBeDefined();
    expect(e.libras_planta).toBeDefined();
    expect(e.general).toMatch(/gaveta/);
  });
  it('con todo completo no hay errores', () => {
    const f = base({ gavetas: [{ num_gaveta: 1, peso_lb: 50 }] });
    expect(validarRecepcion(f, ctx({ cerrando: true }))).toEqual({});
  });
});

describe('aPayload', () => {
  const extra = { client_uuid: 'u-1', estado: 'borrador' as const, loteExiste: false };
  it('convierte a lo que espera la base de datos', () => {
    const p = aPayload(base({ lote_id: ' 123-456a-789 ', placa_vehiculo: ' ', piscina: 'P7' }), extra);
    expect(p.lote_id).toBe('123-456A-789');
    expect(p.placa_vehiculo).toBeNull();
    expect(p.piscina).toBe('P7');
    expect(p.num_gavetas_bines).toBe(3);
    expect(p.proveedor).toBe('Prov');
    expect(p.recepcion_id).toBeUndefined();
  });
  it('no envía el proveedor si el lote ya existe', () => { expect('proveedor' in aPayload(base(), { ...extra, loteExiste: true })).toBe(false); });
  it('al editar envía identificador y versión', () => {
    const p = aPayload(base(), { ...extra, recepcion_id: 'REC-20261024-0001', version: 2 });
    expect(p.recepcion_id).toBe('REC-20261024-0001');
    expect(p.version).toBe(2);
  });
});
