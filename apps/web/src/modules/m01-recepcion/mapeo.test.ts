import { describe, expect, it } from 'vitest';
import { capacidades, paginacion, recepcionAForm } from './mapeo';
import type { RecepcionDetalle } from './tipos';

const base: RecepcionDetalle = {
  recepcion_id: 'REC-20261024-001', version: 3, estado: 'borrador', estado_previo: null, fecha_llegada: '2026-10-24',
  placa_vehiculo: 'ABC-123', lote_id: '123-456-789', piscina: null, guia_remision: 'G-1', llegada_en: 'gavetas', num_gavetas_bines: 40,
  libras_reportadas: 1000, libras_planta: 990.5, diferencia_lb: -9.5, diferencia_pct: -0.95,
  hora_inicio_descarga: '08:15:00', hora_fin_descarga: null, observacion: null, proveedor_nombre: 'Camaronera Sol', especie_nombre: 'Litopenaeus vannamei',
  realizado_por_nombre: 'Pedro', lote_cerrado: false, creado_por: 'u1', modificado_en: '2026-10-24T10:00:00Z',
  motivo_anulacion: null, anulado_en: null, eliminado_en: null,
  gavetas: [{ num_gaveta: 1, peso_lb: 25.5 }, { num_gaveta: 3, peso_lb: 26 }],
  temperaturas: [{ lectura_id: 1, num_gaveta: 3, temperatura_c: 2.5 }],
  almacenamiento: [], fotos: [],
};

describe('recepcionAForm', () => {
  it('pone cada peso en su casilla (gaveta 1 = posición 0)', () => {
    const f = recepcionAForm(base);
    expect(f.gavetas).toHaveLength(30);
    expect(f.gavetas[0]).toBe(25.5);
    expect(f.gavetas[1]).toBeNull();
    expect(f.gavetas[2]).toBe(26);
  });
  it('convierte textos vacíos y horas', () => {
    const f = recepcionAForm(base);
    expect(f.piscina).toBe('');
    expect(f.hora_inicio_descarga).toBe('08:15');
    expect(f.hora_fin_descarga).toBe('');
    expect(f.num_gavetas_bines).toBe('40');
    expect(f.llegada_en).toBe('gavetas');
    expect(f.proveedor).toBe('Camaronera Sol');
    expect(f.cerrar_lote).toBe(false);
  });
  it('sin temperaturas deja 2 filas vacías; sin almacenamiento, una fila vacía', () => {
    const f = recepcionAForm({ ...base, temperaturas: [] });
    expect(f.temperaturas).toHaveLength(2);
    expect(f.almacenamiento).toHaveLength(1);
  });
  it('conserva las temperaturas y el almacenamiento existentes', () => {
    const f = recepcionAForm({ ...base, almacenamiento: [{ num_bin: '1', sellos_recepcion: null, sellos_almacenamiento: 'S9', temperatura_c: 3, libras_aprox: 500 }] });
    expect(f.temperaturas).toEqual([{ num_gaveta: 3, temperatura_c: 2.5 }]);
    expect(f.almacenamiento[0]).toEqual({ num_bin: '1', sellos_recepcion: '', sellos_almacenamiento: 'S9', temperatura_c: 3, libras_aprox: 500 });
  });
  it('acepta números que llegan como texto', () => {
    const f = recepcionAForm({ ...base, libras_reportadas: '1000.50' as unknown as number, gavetas: [{ num_gaveta: 2, peso_lb: '24.25' as unknown as number }] });
    expect(f.libras_reportadas).toBe(1000.5);
    expect(f.gavetas[1]).toBe(24.25);
  });
});

describe('capacidades', () => {
  const todos = () => true;
  const solo = (...p: string[]) => (x: string) => p.includes(x);
  it('el autor operativo edita y anula su borrador, pero no elimina', () => {
    const c = capacidades({ estado: 'borrador', creado_por: 'u1' }, 'u1', solo('ver', 'crear', 'editar', 'anular'));
    expect(c).toEqual({ editar: true, devolver: false, anular: true, eliminar: false, reactivar: false });
  });
  it('otro operativo no edita ni anula lo ajeno', () => {
    const c = capacidades({ estado: 'cerrado', creado_por: 'u1' }, 'u2', solo('ver', 'editar', 'anular'));
    expect(c.editar).toBe(false);
    expect(c.anular).toBe(false);
  });
  it('el administrador hace todo según el estado', () => {
    expect(capacidades({ estado: 'cerrado', creado_por: 'u1' }, 'u9', todos)).toEqual({ editar: true, devolver: true, anular: true, eliminar: true, reactivar: false });
    expect(capacidades({ estado: 'anulado', creado_por: 'u1' }, 'u9', todos)).toEqual({ editar: false, devolver: false, anular: false, eliminar: true, reactivar: true });
    expect(capacidades({ estado: 'eliminado', creado_por: 'u1' }, 'u9', todos)).toEqual({ editar: false, devolver: false, anular: false, eliminar: false, reactivar: true });
  });
  it('consulta no puede nada', () => {
    expect(capacidades({ estado: 'borrador', creado_por: 'u1' }, 'u1', solo('ver', 'ver_reportes')))
      .toEqual({ editar: false, devolver: false, anular: false, eliminar: false, reactivar: false });
  });
  it('sin usuario conocido no se es autor', () => {
    expect(capacidades({ estado: 'borrador', creado_por: null }, undefined, solo('editar')).editar).toBe(false);
  });
});

describe('paginacion', () => {
  it('calcula página y total', () => {
    expect(paginacion(0, 0, 20)).toEqual({ pagina: 1, paginas: 1 });
    expect(paginacion(45, 0, 20)).toEqual({ pagina: 1, paginas: 3 });
    expect(paginacion(45, 40, 20)).toEqual({ pagina: 3, paginas: 3 });
    expect(paginacion(40, 20, 20)).toEqual({ pagina: 2, paginas: 2 });
  });
});

describe('devolver a borrador', () => {
  const solo = (...p: string[]) => (x: string) => p.includes(x);
  it('solo una recepción cerrada, por su autor o por quien puede eliminar', () => {
    expect(capacidades({ estado: 'cerrado', creado_por: 'u1' }, 'u1', solo('ver', 'editar')).devolver).toBe(true);
    expect(capacidades({ estado: 'cerrado', creado_por: 'u1' }, 'u2', solo('ver', 'editar')).devolver).toBe(false);
    expect(capacidades({ estado: 'borrador', creado_por: 'u1' }, 'u1', solo('ver', 'editar')).devolver).toBe(false);
    expect(capacidades({ estado: 'cerrado', creado_por: 'u1' }, 'u1', solo('ver')).devolver).toBe(false);
  });
});
