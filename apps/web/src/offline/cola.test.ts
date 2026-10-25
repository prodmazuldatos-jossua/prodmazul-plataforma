import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/errores';
import { Cola, type Dependencias } from './cola';
import { almacenEnMemoria, type FotoPendiente } from './db';
import type { FormRecepcion } from '../modules/m01-recepcion/tipos';

const form = {} as FormRecepcion;
const resumen = { lote_id: '123-456-789', guia_remision: 'G-1', proveedor: 'P', especie: 'E', fecha_llegada: '2026-10-25', estado: 'cerrado' as const };
const foto = (id: string): FotoPendiente => ({ id, nombre: `${id}.jpg`, tipo: 'image/jpeg', blob: new Blob(['x']), tamano: 1 });

/** Un «servidor» de mentira que se comporta como la base de datos: reenviar el mismo client_uuid no duplica. */
function servidor() {
  const recepciones = new Map<string, string>(); // client_uuid -> recepcion_id
  const fotos: { recepcion: string; id: string }[] = [];
  const s = {
    recepciones, fotos, llamadas: 0, caerDespuesDeGuardar: 0, fallaGuardar: null as Error | null, fallaFoto: null as ((f: FotoPendiente) => Error | null) | null,
    guardar: async (payload: Record<string, unknown>) => {
      s.llamadas++;
      if (s.fallaGuardar) throw s.fallaGuardar;
      const uuid = String(payload.client_uuid);
      if (!recepciones.has(uuid)) recepciones.set(uuid, `REC-${recepciones.size + 1}`);
      if (s.caerDespuesDeGuardar > 0) { s.caerDespuesDeGuardar--; throw new TypeError('Failed to fetch'); } // llegó, pero se perdió la respuesta
      return { recepcion_id: recepciones.get(uuid)!, version: 1, estado: 'cerrado' };
    },
    subirFoto: async (rid: string, f: FotoPendiente, avanzar: (x: FotoPendiente) => Promise<void>) => {
      const e = s.fallaFoto?.(f);
      if (e) throw e;
      if (!f.reg) await avanzar({ ...f, reg: { foto_id: `F-${f.id}`, ruta: `r/${f.id}` } });
      if (!fotos.some((x) => x.id === f.id)) fotos.push({ recepcion: rid, id: f.id });
    },
  };
  return s;
}

function nueva(s = servidor(), extra: Partial<Dependencias> = {}) {
  const almacen = almacenEnMemoria();
  const cola = new Cola({ almacen, guardar: s.guardar, subirFoto: s.subirFoto, ...extra });
  const enc = (uuid: string, user = 'u1', fotos: FotoPendiente[] = []) => cola.encolar({ client_uuid: uuid, user_id: user, payload: { client_uuid: uuid, guia_remision: 'G' }, form, fotos, resumen });
  return { s, cola, almacen, enc };
}

describe('cola de pendientes', () => {
  it('guarda en el dispositivo y cuenta por persona', async () => {
    const { cola, enc } = nueva();
    await enc('a', 'u1'); await enc('b', 'u2');
    expect((await cola.contar()).total).toBe(2);
    expect((await cola.contar('u1')).total).toBe(1);
    expect((await cola.listar('u1'))[0].estado).toBe('en_espera');
  });

  it('envía y borra lo enviado', async () => {
    const { s, cola, enc } = nueva();
    await enc('a');
    const r = await cola.sincronizar('u1');
    expect(r.enviadas).toBe(1);
    expect(s.recepciones.size).toBe(1);
    expect((await cola.contar()).total).toBe(0);
  });

  it('solo envía lo de la persona que tiene la sesión', async () => {
    const { s, cola, enc } = nueva();
    await enc('a', 'u1'); await enc('b', 'u2');
    await cola.sincronizar('u1');
    expect([...s.recepciones.keys()]).toEqual(['a']);
    expect((await cola.contar('u2')).total).toBe(1);
  });

  it('sin conexión no pierde nada y deja de intentar con los demás', async () => {
    const { s, cola, enc } = nueva();
    s.fallaGuardar = new TypeError('Failed to fetch');
    await enc('a'); await enc('b');
    const r = await cola.sincronizar('u1');
    expect(r.sinRed).toBe(true);
    expect(s.llamadas).toBe(1); // no insistió con la segunda
    const l = await cola.listar('u1');
    expect(l).toHaveLength(2);
    expect(l.every((p) => p.estado === 'en_espera')).toBe(true);
    expect(l[0].intentos).toBe(0); // la falta de señal no cuenta como intento fallido
  });

  it('cortar la señal a mitad del envío NO duplica la recepción', async () => {
    const { s, cola, enc } = nueva();
    await enc('a');
    s.caerDespuesDeGuardar = 1; // el servidor la guarda pero la respuesta no llega
    const r1 = await cola.sincronizar('u1');
    expect(r1.sinRed).toBe(true);
    expect((await cola.contar()).total).toBe(1);
    const r2 = await cola.sincronizar('u1');
    expect(r2.enviadas).toBe(1);
    expect(s.recepciones.size).toBe(1); // sigue habiendo una sola
    expect(s.llamadas).toBe(2);
    expect((await cola.contar()).total).toBe(0);
  });

  it('un error de validación rechaza el pendiente y no se reintenta solo', async () => {
    const { s, cola, enc } = nueva();
    s.fallaGuardar = new ApiError('E_DUPLICADO', 'Ya existe una recepción con esa guía de remisión.');
    await enc('a');
    const r = await cola.sincronizar('u1');
    expect(r.rechazadas).toBe(1);
    const p = (await cola.listar())[0];
    expect(p.estado).toBe('rechazada');
    expect(p.ultimo_error).toContain('guía');
    s.llamadas = 0;
    await cola.sincronizar('u1');
    expect(s.llamadas).toBe(0);
  });

  it('corregir un rechazado lo devuelve a la fila y se envía', async () => {
    const { s, cola, enc } = nueva();
    s.fallaGuardar = new ApiError('E_DUPLICADO', 'Guía repetida.');
    await enc('a');
    await cola.sincronizar('u1');
    s.fallaGuardar = null;
    await cola.corregir('a', { payload: { client_uuid: 'a', guia_remision: 'G-NUEVA' }, form, fotos: [], resumen: { ...resumen, guia_remision: 'G-NUEVA' } });
    const p = (await cola.obtener('a'))!;
    expect(p.estado).toBe('en_espera');
    expect(p.ultimo_error).toBeUndefined();
    expect((await cola.sincronizar('u1')).enviadas).toBe(1);
  });

  it('descartar borra del dispositivo', async () => {
    const { cola, enc } = nueva();
    await enc('a');
    await cola.descartar('a');
    expect((await cola.contar()).total).toBe(0);
  });

  it('un error raro se reintenta y a los 5 intentos pasa a rechazada', async () => {
    const { s, cola, enc } = nueva();
    s.fallaGuardar = new ApiError('E_DESCONOCIDO', 'Ocurrió un error inesperado.');
    await enc('a');
    for (let i = 0; i < 4; i++) await cola.sincronizar('u1');
    expect((await cola.listar())[0].estado).toBe('en_espera');
    await cola.sincronizar('u1');
    expect((await cola.listar())[0].estado).toBe('rechazada');
  });

  it('sesión vencida: se detiene sin rechazar', async () => {
    const { s, cola, enc } = nueva();
    s.fallaGuardar = new ApiError('E_SESION', 'Tu sesión venció.');
    await enc('a');
    const r = await cola.sincronizar('u1');
    expect(r.sesionVencida).toBe(true);
    expect((await cola.listar())[0].estado).toBe('en_espera');
  });

  it('dos sincronizaciones a la vez: la segunda no hace nada', async () => {
    const { s, cola, enc } = nueva();
    await enc('a');
    const [r1, r2] = await Promise.all([cola.sincronizar('u1'), cola.sincronizar('u1')]);
    expect(r2.omitido).toBe(true);
    expect(r1.enviadas).toBe(1);
    expect(s.llamadas).toBe(1);
  });

  it('sube las fotos y las quita de la cola una a una', async () => {
    const { s, cola, enc } = nueva();
    await enc('a', 'u1', [foto('f1'), foto('f2')]);
    const r = await cola.sincronizar('u1');
    expect(r.enviadas).toBe(1);
    expect(s.fotos.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect((await cola.contar()).total).toBe(0);
  });

  it('si falla la señal subiendo fotos: la recepción ya no se reenvía y solo faltan las fotos', async () => {
    const { s, cola, enc } = nueva();
    await enc('a', 'u1', [foto('f1'), foto('f2')]);
    s.fallaFoto = (f) => (f.id === 'f2' ? new TypeError('Failed to fetch') : null);
    const r1 = await cola.sincronizar('u1');
    expect(r1.sinRed).toBe(true);
    let p = (await cola.listar())[0];
    expect(p.recepcion_id).toBe('REC-1');
    expect(p.fotos.map((f) => f.id)).toEqual(['f2']); // f1 ya subió
    s.fallaFoto = null; s.llamadas = 0;
    const r2 = await cola.sincronizar('u1');
    expect(r2.enviadas).toBe(1);
    expect(s.llamadas).toBe(0); // no volvió a enviar la recepción
    expect(s.fotos.map((f) => f.id)).toEqual(['f1', 'f2']); // sin fotos duplicadas
    p = (await cola.listar())[0];
    expect(p).toBeUndefined();
  });

  it('el avance de una foto (registrada / subida) se conserva para reanudarla', async () => {
    const { s, cola, enc } = nueva();
    await enc('a', 'u1', [foto('f1')]);
    s.fallaFoto = () => null;
    const original = s.subirFoto;
    s.subirFoto = async (_rid, f, avanzar) => { await avanzar({ ...f, reg: { foto_id: 'F-1', ruta: 'r/f1' }, subida: true }); throw new TypeError('Failed to fetch'); };
    const cola2 = new Cola({ almacen: (cola as unknown as { dep: Dependencias }).dep.almacen, guardar: s.guardar, subirFoto: s.subirFoto });
    await cola2.sincronizar('u1');
    const p = (await cola2.listar())[0];
    expect(p.fotos[0].reg?.foto_id).toBe('F-1');
    expect(p.fotos[0].subida).toBe(true);
    void original;
  });

  it('no permite corregir lo que ya está en el servidor', async () => {
    const { s, cola, enc } = nueva();
    await enc('a', 'u1', [foto('f1')]);
    s.fallaFoto = () => new ApiError('E_PERMISO', 'No tienes permiso para subir esta foto.');
    await cola.sincronizar('u1');
    await expect(cola.corregir('a', { payload: {}, form, fotos: [], resumen })).rejects.toThrow(/ya está guardada/);
  });

  it('avisa a quien escuche cada cambio', async () => {
    const { cola, enc } = nueva();
    let avisos = 0;
    cola.suscribir(() => { avisos++; });
    await enc('a');
    await cola.sincronizar('u1');
    expect(avisos).toBeGreaterThan(2);
  });
});
