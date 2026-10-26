import { describe, expect, it } from 'vitest';
import { aPayload, loteValido, validarRecepcion, type ContextoValidacion } from './esquema';
import { FORMATO_LOTE_POR_DEFECTO, filaAlmacenamientoVacia, gavetasVacias, lecturasVacias, type AlmacenamientoForm, type FormRecepcion } from './tipos';

const ctx = (extra: Partial<ContextoValidacion> = {}): ContextoValidacion =>
  ({ formatoLote: FORMATO_LOTE_POR_DEFECTO, hoy: '2026-10-24', cerrando: false, loteExiste: false, ...extra });

const base = (extra: Partial<FormRecepcion> = {}): FormRecepcion => ({
  fecha_llegada: '2026-10-24', placa_vehiculo: '', lote_id: '123-456-789', proveedor: 'Prov', especie: 'Camarón', piscina: '',
  guia_remision: 'G-1', llegada_en: 'bines', num_gavetas_bines: '3', libras_reportadas: 1000, libras_planta: 990,
  hora_inicio_descarga: '08:00', hora_fin_descarga: '09:00', observacion: '', cerrar_lote: false, gavetas: gavetasVacias(), temperaturas: lecturasVacias(), almacenamiento: [filaAlmacenamientoVacia()], ...extra,
});

const conPesos = (m: Record<number, number>) => gavetasVacias().map((_, i) => (i in m ? m[i] : null));
const fila = (c: Partial<AlmacenamientoForm>): AlmacenamientoForm => ({ ...filaAlmacenamientoVacia(), ...c });

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
    expect(e.gavetas).toMatch(/gaveta/);
  });
  it('con todo completo no hay errores', () => {
    const f = base({ gavetas: conPesos({ 0: 50 }) });
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

describe('gavetas', () => {
  it('un peso en cero o negativo es error, y las casillas vacías se ignoran', () => {
    const e = validarRecepcion(base({ gavetas: conPesos({ 0: 0, 1: -5, 2: 40 }) }), ctx());
    expect(e.filas?.gavetas[0]).toBeDefined();
    expect(e.filas?.gavetas[1]).toBeDefined();
    expect(e.filas?.gavetas[2]).toBeUndefined();
  });
  it('el payload numera las gavetas según su posición y omite las vacías', () => {
    const p = aPayload(base({ gavetas: conPesos({ 0: 50, 4: 61.5 }) }), { client_uuid: 'u', estado: 'borrador', loteExiste: false });
    expect(p.gavetas).toEqual([{ num_gaveta: 1, peso_lb: 50 }, { num_gaveta: 5, peso_lb: 61.5 }]);
  });
});

describe('almacenamiento', () => {
  it('las filas vacías se ignoran', () => { expect(validarRecepcion(base(), ctx()).filas).toBeUndefined(); });
  it('una fila en uso exige número de bin', () => {
    expect(validarRecepcion(base({ almacenamiento: [fila({ sellos_recepcion: 'S1' })] }), ctx()).filas?.almacenamiento[0]?.num_bin).toBeDefined();
  });
  it('rechaza bines y sellos repetidos sin distinguir mayúsculas', () => {
    const e = validarRecepcion(base({ almacenamiento: [
      fila({ num_bin: 'B1', sellos_recepcion: 'ab1', sellos_almacenamiento: 'x1' }),
      fila({ num_bin: 'b1', sellos_recepcion: 'AB1', sellos_almacenamiento: 'X1' }),
    ] }), ctx());
    expect(e.filas?.almacenamiento[1]?.num_bin).toBeDefined();
    expect(e.filas?.almacenamiento[1]?.sellos_recepcion).toBeDefined();
    expect(e.filas?.almacenamiento[1]?.sellos_almacenamiento).toBeDefined();
  });
  it('temperatura dentro de rango y libras mayores que cero', () => {
    const e = validarRecepcion(base({ almacenamiento: [fila({ num_bin: 'B1', temperatura_c: 80, libras_aprox: 0 })] }), ctx());
    expect(e.filas?.almacenamiento[0]?.temperatura_c).toBeDefined();
    expect(e.filas?.almacenamiento[0]?.libras_aprox).toBeDefined();
    const ok = validarRecepcion(base({ almacenamiento: [fila({ num_bin: 'B1', temperatura_c: -2.5, libras_aprox: 300 })] }), ctx());
    expect(ok.filas).toBeUndefined();
  });
  it('el payload recorta los textos y omite filas vacías', () => {
    const p = aPayload(base({ almacenamiento: [fila({ num_bin: ' B1 ', sellos_recepcion: ' S1 ', libras_aprox: 300 }), filaAlmacenamientoVacia()] }),
      { client_uuid: 'u', estado: 'borrador', loteExiste: false });
    expect(p.almacenamiento).toHaveLength(1);
    expect((p.almacenamiento as { num_bin: string; sellos_recepcion: string }[])[0]).toMatchObject({ num_bin: 'B1', sellos_recepcion: 'S1', libras_aprox: 300 });
  });
});

describe('temperaturas por gaveta', () => {
  const gav = conPesos({ 0: 50, 1: 51, 29: 60 });
  const lects = (...l: { num_gaveta: number | null; temperatura_c: number | null }[]) => l;
  it('por defecto hay 2 filas vacías y no dan error', () => {
    expect(lecturasVacias()).toHaveLength(2);
    expect(validarRecepcion(base(), ctx()).filas).toBeUndefined();
  });
  it('una fila necesita gaveta y temperatura', () => {
    const e = validarRecepcion(base({ gavetas: gav, temperaturas: lects({ num_gaveta: 1, temperatura_c: null }, { num_gaveta: null, temperatura_c: 3 }) }), ctx());
    expect(e.filas?.lecturas[0]?.temperatura_c).toBeDefined();
    expect(e.filas?.lecturas[1]?.num_gaveta).toBeDefined();
  });
  it('la gaveta debe tener peso registrado', () => {
    const e = validarRecepcion(base({ gavetas: gav, temperaturas: lects({ num_gaveta: 7, temperatura_c: 2 }) }), ctx());
    expect(e.filas?.lecturas[0]?.num_gaveta).toMatch(/no tiene peso/);
  });
  it('una gaveta no puede tener dos temperaturas', () => {
    const e = validarRecepcion(base({ gavetas: gav, temperaturas: lects({ num_gaveta: 2, temperatura_c: 1 }, { num_gaveta: 2, temperatura_c: 3 }) }), ctx());
    expect(e.filas?.lecturas[0]).toBeUndefined();
    expect(e.filas?.lecturas[1]?.num_gaveta).toMatch(/ya tiene temperatura/);
  });
  it('rechaza temperaturas fuera de rango', () => {
    const e = validarRecepcion(base({ gavetas: gav, temperaturas: lects({ num_gaveta: 1, temperatura_c: 90 }) }), ctx());
    expect(e.filas?.lecturas[0]?.temperatura_c).toBeDefined();
  });
  it('acepta temperaturas negativas y las envía con el número de gaveta', () => {
    const f = base({ gavetas: gav, temperaturas: [...lects({ num_gaveta: 30, temperatura_c: -1.5 }, { num_gaveta: 1, temperatura_c: 2 }), { num_gaveta: null, temperatura_c: null }] });
    expect(validarRecepcion(f, ctx()).filas).toBeUndefined();
    const p = aPayload(f, { client_uuid: 'u', estado: 'borrador', loteExiste: false });
    expect(p.temperaturas).toEqual([{ lectura_id: 1, num_gaveta: 30, temperatura_c: -1.5 }, { lectura_id: 2, num_gaveta: 1, temperatura_c: 2 }]);
  });
  it('quitar el peso de una gaveta invalida su temperatura', () => {
    const f = base({ gavetas: conPesos({ 0: 50 }), temperaturas: lects({ num_gaveta: 5, temperatura_c: 2 }) });
    expect(validarRecepcion(f, ctx()).filas?.lecturas[0]?.num_gaveta).toBeDefined();
  });
});

describe('cierre de lote', () => {
  const extra = { client_uuid: 'u', loteExiste: true };
  it('solo se envía cerrar_lote al guardar y cerrar con la opción marcada', () => {
    expect(aPayload(base({ cerrar_lote: true }), { ...extra, estado: 'cerrado' }).cerrar_lote).toBe(true);
    expect(aPayload(base({ cerrar_lote: true }), { ...extra, estado: 'borrador' }).cerrar_lote).toBeUndefined();
    expect(aPayload(base({ cerrar_lote: false }), { ...extra, estado: 'cerrado' }).cerrar_lote).toBeUndefined();
  });
  it('una recepción nueva en un lote cerrado se rechaza en el campo del lote', () => {
    expect(validarRecepcion(base(), ctx({ loteCerrado: true })).lote_id).toMatch(/ya está cerrado/);
    expect(validarRecepcion(base(), ctx({ loteCerrado: false })).lote_id).toBeUndefined();
  });
});

describe('un proveedor con varios lotes', () => {
  it('cada lote nuevo lleva el proveedor; el lote existente no lo envía', () => {
    const nuevo = aPayload(base({ lote_id: '111-111-111', proveedor: 'Prov A' }), { client_uuid: 'u', estado: 'borrador', loteExiste: false });
    const otro = aPayload(base({ lote_id: '222-222-222', proveedor: 'Prov A' }), { client_uuid: 'u2', estado: 'borrador', loteExiste: false });
    expect(nuevo.proveedor).toBe('Prov A');
    expect(otro.proveedor).toBe('Prov A');
    expect('proveedor' in aPayload(base({ lote_id: '111-111-111' }), { client_uuid: 'u3', estado: 'borrador', loteExiste: true })).toBe(false);
  });
});

describe('bines o gavetas', () => {
  const extra = { client_uuid: 'u', estado: 'borrador' as const, loteExiste: false };
  it('por defecto llega en bines y se envía en el payload', () => {
    expect(aPayload(base(), extra).llegada_en).toBe('bines');
    expect(aPayload(base({ llegada_en: 'gavetas' }), extra).llegada_en).toBe('gavetas');
  });
  it('el mensaje de cantidad vacía nombra lo escogido', () => {
    expect(validarRecepcion(base({ num_gavetas_bines: '' }), ctx()).num_gavetas_bines).toMatch(/bines/);
    expect(validarRecepcion(base({ llegada_en: 'gavetas', num_gavetas_bines: '' }), ctx()).num_gavetas_bines).toMatch(/gavetas/);
  });
  it('ya no se compara el número indicado con las gavetas pesadas', () => {
    const f = base({ num_gavetas_bines: '5', gavetas: gavetasVacias().map((_, i) => (i < 12 ? 50 : null)) });
    expect(validarRecepcion(f, ctx({ cerrando: true })).filas).toBeUndefined();
    expect(validarRecepcion(f, ctx({ cerrando: true })).num_gavetas_bines).toBeUndefined();
  });
});

describe('libras frente al peso de las gavetas', () => {
  const pesos = () => base({ gavetas: conPesos({ 0: 600, 1: 500 }), libras_reportadas: 1000, libras_planta: 1100 });
  it('libras reportadas menores al total de gavetas dan error', () => {
    expect(validarRecepcion(pesos(), ctx()).libras_reportadas).toMatch(/menor que el peso total/);
    expect(validarRecepcion(pesos(), ctx()).libras_planta).toBeUndefined();
  });
  it('libras de planta menores al total de gavetas dan error', () => {
    const e = validarRecepcion(base({ gavetas: conPesos({ 0: 600, 1: 500 }), libras_reportadas: 1100, libras_planta: 1099.99 }), ctx());
    expect(e.libras_planta).toMatch(/menor que el peso total/);
    expect(e.libras_reportadas).toBeUndefined();
  });
  it('iguales o mayores son válidas', () => {
    expect(validarRecepcion(base({ gavetas: conPesos({ 0: 600, 1: 500 }), libras_reportadas: 1100, libras_planta: 1100 }), ctx())).toEqual({});
  });
  it('usa la unidad elegida en el mensaje', () => {
    expect(validarRecepcion(pesos(), ctx({ pesoTexto: (lb) => `${(lb / 2.20462).toFixed(1)} kg` })).libras_reportadas).toContain('kg');
  });
});
