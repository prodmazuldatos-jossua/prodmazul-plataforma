import type { FormRecepcion } from '../modules/m01-recepcion/tipos';

/** Una foto que espera en el dispositivo. `reg` y `subida` guardan hasta dónde llegó su envío, para reanudarlo sin duplicar. */
export interface FotoPendiente {
  id: string;
  nombre: string;
  tipo: string;
  blob: Blob;
  tamano: number;
  /** Registro de la foto en el servidor (ya se pidió su cupo y su ruta). */
  reg?: { foto_id: string; ruta: string };
  /** El archivo ya está en el almacenamiento; solo falta confirmarla. */
  subida?: boolean;
}

export type EstadoPendiente = 'en_espera' | 'rechazada';

/** Una recepción creada en este dispositivo que todavía no llegó al servidor (o le faltan fotos). */
export interface Pendiente {
  /** Identificador único del envío: el servidor lo usa para no duplicar. */
  client_uuid: string;
  user_id: string;
  creado_en: string;
  estado: EstadoPendiente;
  /** Lo que se envía tal cual a la base de datos. */
  payload: Record<string, unknown>;
  /** Lo escrito en el formulario, para poder corregirlo si el servidor lo rechaza. */
  form: FormRecepcion;
  fotos: FotoPendiente[];
  /** Si ya se guardó en el servidor, su número: solo faltan fotos por subir. */
  recepcion_id?: string;
  intentos: number;
  ultimo_error?: string;
  codigo_error?: string;
  ultimo_intento?: string;
  resumen: { lote_id: string; guia_remision: string; proveedor: string; especie: string; fecha_llegada: string; estado: 'borrador' | 'cerrado' };
}

/** Dónde se guardan los pendientes. En el navegador es IndexedDB; en las pruebas, la memoria. */
export interface Almacen {
  listar(): Promise<Pendiente[]>;
  obtener(uuid: string): Promise<Pendiente | undefined>;
  guardar(p: Pendiente): Promise<void>;
  borrar(uuid: string): Promise<void>;
}

export function almacenEnMemoria(): Almacen {
  const m = new Map<string, Pendiente>();
  // structuredClone imita a IndexedDB: lo guardado es una copia, no el mismo objeto.
  return {
    async listar() { return [...m.values()].map((x) => structuredClone(x)); },
    async obtener(uuid) { const x = m.get(uuid); return x ? structuredClone(x) : undefined; },
    async guardar(p) { m.set(p.client_uuid, structuredClone(p)); },
    async borrar(uuid) { m.delete(uuid); },
  };
}

const NOMBRE_BD = 'prodmazul-local';
const TIENDA = 'pendientes';

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(NOMBRE_BD, 1);
    pedido.onupgradeneeded = () => {
      if (!pedido.result.objectStoreNames.contains(TIENDA)) pedido.result.createObjectStore(TIENDA, { keyPath: 'client_uuid' });
    };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error ?? new Error('No se pudo abrir el almacenamiento del dispositivo.'));
  });
}

function pedir<T>(modo: IDBTransactionMode, accion: (t: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return abrir().then((bd) => new Promise<T>((resolve, reject) => {
    const tx = bd.transaction(TIENDA, modo);
    const r = accion(tx.objectStore(TIENDA));
    tx.oncomplete = () => { bd.close(); resolve(r.result); };
    tx.onerror = () => { bd.close(); reject(tx.error ?? new Error('Falló el almacenamiento del dispositivo.')); };
    tx.onabort = () => { bd.close(); reject(tx.error ?? new Error('Falló el almacenamiento del dispositivo.')); };
  }));
}

/** Almacén real del navegador (IndexedDB): lo guardado sobrevive a cerrar la aplicación o apagar la tablet. */
export function almacenIndexedDB(): Almacen {
  return {
    listar: () => pedir<Pendiente[]>('readonly', (t) => t.getAll()),
    obtener: (uuid) => pedir<Pendiente | undefined>('readonly', (t) => t.get(uuid)),
    guardar: (p) => pedir('readwrite', (t) => t.put(p)).then(() => undefined),
    borrar: (uuid) => pedir('readwrite', (t) => t.delete(uuid)).then(() => undefined),
  };
}
