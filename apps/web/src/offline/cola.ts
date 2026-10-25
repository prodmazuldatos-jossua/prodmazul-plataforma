import { aApiError } from '../lib/errores';
import type { Almacen, FotoPendiente, Pendiente } from './db';

export interface RespuestaEnvio { recepcion_id: string; version: number; estado: string }

export interface Dependencias {
  almacen: Almacen;
  /** Envía la recepción a la base de datos. Reenviar el mismo `client_uuid` no la duplica. */
  guardar: (payload: Record<string, unknown>) => Promise<RespuestaEnvio>;
  /** Sube una foto en pasos que se pueden reanudar; avisa con `alAvanzar` cada vez que da un paso. */
  subirFoto: (recepcionId: string, foto: FotoPendiente, alAvanzar: (f: FotoPendiente) => Promise<void>) => Promise<void>;
  ahora?: () => Date;
  /** Cuántos intentos fallidos «raros» (no de conexión) se toleran antes de pasar a «rechazada». */
  maxIntentos?: number;
}

export interface ResultadoSincronizacion {
  enviadas: number;
  rechazadas: number;
  enEspera: number;
  sinRed: boolean;
  sesionVencida: boolean;
  /** Ya había otra sincronización en curso: no se hizo nada. */
  omitido: boolean;
}

export type EventoCola = { tipo: 'cambio' } | { tipo: 'resultado'; resultado: ResultadoSincronizacion };

export interface DatosNuevoPendiente {
  client_uuid: string;
  user_id: string;
  payload: Record<string, unknown>;
  form: Pendiente['form'];
  fotos: FotoPendiente[];
  resumen: Pendiente['resumen'];
}

/** Errores que no se arreglan reintentando: la persona debe corregir o descartar. */
const DEFINITIVOS = new Set(['E_VALIDACION', 'E_DUPLICADO', 'E_ESTADO', 'E_PERMISO', 'E_NO_ENCONTRADO', 'E_VERSION']);

export class Cola {
  private enCurso: Promise<ResultadoSincronizacion> | null = null;
  private oyentes = new Set<(e: EventoCola) => void>();
  private readonly maxIntentos: number;

  constructor(readonly dep: Dependencias) {
    this.maxIntentos = dep.maxIntentos ?? 5;
  }

  private ahora(): string { return (this.dep.ahora ? this.dep.ahora() : new Date()).toISOString(); }
  private avisar(e: EventoCola) { this.oyentes.forEach((f) => { try { f(e); } catch { /* un oyente roto no frena a los demás */ } }); }

  suscribir(f: (e: EventoCola) => void): () => void {
    this.oyentes.add(f);
    return () => { this.oyentes.delete(f); };
  }

  get sincronizando(): boolean { return this.enCurso !== null; }

  /** Pendientes de una persona (o de todas si no se indica), del más antiguo al más nuevo. */
  async listar(userId?: string): Promise<Pendiente[]> {
    const todos = await this.dep.almacen.listar();
    return todos.filter((p) => userId === undefined || p.user_id === userId).sort((a, b) => (a.creado_en < b.creado_en ? -1 : a.creado_en > b.creado_en ? 1 : 0));
  }

  async contar(userId?: string): Promise<{ total: number; enEspera: number; rechazadas: number }> {
    const l = await this.listar(userId);
    const rechazadas = l.filter((p) => p.estado === 'rechazada').length;
    return { total: l.length, enEspera: l.length - rechazadas, rechazadas };
  }

  obtener(uuid: string): Promise<Pendiente | undefined> { return this.dep.almacen.obtener(uuid); }

  async encolar(d: DatosNuevoPendiente): Promise<Pendiente> {
    const p: Pendiente = { ...d, creado_en: this.ahora(), estado: 'en_espera', intentos: 0 };
    await this.dep.almacen.guardar(p);
    this.avisar({ tipo: 'cambio' });
    return p;
  }

  /** La persona corrigió una recepción rechazada: vuelve a la fila de envío. Solo vale si aún no está en el servidor. */
  async corregir(uuid: string, cambios: Pick<DatosNuevoPendiente, 'payload' | 'form' | 'fotos' | 'resumen'>): Promise<Pendiente> {
    const p = await this.dep.almacen.obtener(uuid);
    if (!p) throw new Error('Ese pendiente ya no existe en este dispositivo.');
    if (p.recepcion_id) throw new Error('Esa recepción ya está guardada en el servidor; solo se pueden reintentar sus fotos.');
    const nuevo: Pendiente = { ...p, ...cambios, estado: 'en_espera', intentos: 0, ultimo_error: undefined, codigo_error: undefined };
    await this.dep.almacen.guardar(nuevo);
    this.avisar({ tipo: 'cambio' });
    return nuevo;
  }

  /** Vuelve a poner «en espera» un pendiente rechazado, sin cambiar nada. */
  async reintentar(uuid: string): Promise<void> {
    const p = await this.dep.almacen.obtener(uuid);
    if (!p) return;
    await this.dep.almacen.guardar({ ...p, estado: 'en_espera', intentos: 0, ultimo_error: undefined, codigo_error: undefined });
    this.avisar({ tipo: 'cambio' });
  }

  async descartar(uuid: string): Promise<void> {
    await this.dep.almacen.borrar(uuid);
    this.avisar({ tipo: 'cambio' });
  }

  /** Envía lo que esté «en espera» de esa persona. Si ya hay un envío en curso, no hace nada. */
  sincronizar(userId: string): Promise<ResultadoSincronizacion> {
    if (this.enCurso) return Promise.resolve({ enviadas: 0, rechazadas: 0, enEspera: 0, sinRed: false, sesionVencida: false, omitido: true });
    const trabajo = this.procesar(userId).finally(() => { this.enCurso = null; this.avisar({ tipo: 'cambio' }); });
    this.enCurso = trabajo;
    this.avisar({ tipo: 'cambio' });
    return trabajo;
  }

  private async procesar(userId: string): Promise<ResultadoSincronizacion> {
    const r: ResultadoSincronizacion = { enviadas: 0, rechazadas: 0, enEspera: 0, sinRed: false, sesionVencida: false, omitido: false };
    const lista = (await this.listar(userId)).filter((p) => p.estado === 'en_espera');
    for (const original of lista) {
      let p = original;
      try {
        if (!p.recepcion_id) {
          const resp = await this.dep.guardar(p.payload);
          p = { ...p, recepcion_id: resp.recepcion_id };
          await this.dep.almacen.guardar(p); // desde aquí, un reintento ya no vuelve a enviar la recepción
        }
        for (const foto of [...p.fotos]) {
          await this.dep.subirFoto(p.recepcion_id!, foto, async (avance) => {
            p = { ...p, fotos: p.fotos.map((x) => (x.id === avance.id ? avance : x)) };
            await this.dep.almacen.guardar(p);
          });
          p = { ...p, fotos: p.fotos.filter((x) => x.id !== foto.id) };
          await this.dep.almacen.guardar(p);
        }
        await this.dep.almacen.borrar(p.client_uuid);
        r.enviadas++;
        this.avisar({ tipo: 'cambio' });
      } catch (e) {
        const err = aApiError(e);
        const base = { ...p, ultimo_intento: this.ahora(), ultimo_error: err.message, codigo_error: err.codigo };
        if (err.codigo === 'E_RED') {
          await this.dep.almacen.guardar({ ...base, ultimo_error: 'Sin conexión con el servidor.' });
          r.sinRed = true;
          break; // sin señal no tiene sentido seguir con los demás
        }
        if (err.codigo === 'E_SESION') {
          await this.dep.almacen.guardar(base);
          r.sesionVencida = true;
          break;
        }
        const intentos = p.intentos + 1;
        const definitivo = DEFINITIVOS.has(err.codigo) || intentos >= this.maxIntentos;
        await this.dep.almacen.guardar({ ...base, intentos, estado: definitivo ? 'rechazada' : 'en_espera' });
        if (definitivo) r.rechazadas++;
        this.avisar({ tipo: 'cambio' });
      }
    }
    r.enEspera = (await this.contar(userId)).enEspera;
    this.avisar({ tipo: 'resultado', resultado: r });
    return r;
  }
}
