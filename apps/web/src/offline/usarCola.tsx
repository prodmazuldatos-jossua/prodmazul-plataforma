import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../core/auth/AuthContext';
import { useOnline } from '../lib/conexion';
import { cola } from './pendientes';
import type { ResultadoSincronizacion } from './cola';

export const INTERVALO_SINCRONIZACION_MS = 60_000;

export interface EstadoCola {
  total: number;
  enEspera: number;
  rechazadas: number;
  sincronizando: boolean;
  /** Pendientes de otras personas que usaron este dispositivo (se envían cuando ellas inicien sesión). */
  deOtros: number;
  ultimo: ResultadoSincronizacion | null;
  sincronizarAhora: () => Promise<ResultadoSincronizacion | null>;
}

/** Estado de la cola de la persona que tiene la sesión abierta. */
export function usarCola(): EstadoCola {
  const { perfil } = useAuth();
  const uid = perfil?.activo ? perfil.user_id : undefined;
  const [n, setN] = useState({ total: 0, enEspera: 0, rechazadas: 0, deOtros: 0 });
  const [sincronizando, setSincronizando] = useState(cola.sincronizando);
  const [ultimo, setUltimo] = useState<ResultadoSincronizacion | null>(null);

  const leer = useCallback(async () => {
    try {
      const mios = await cola.contar(uid ?? '__nadie__');
      const todos = await cola.contar();
      setN({ ...mios, deOtros: todos.total - mios.total });
    } catch { /* sin almacenamiento local: se muestra 0 */ }
  }, [uid]);

  useEffect(() => {
    void leer();
    return cola.suscribir((e) => {
      setSincronizando(cola.sincronizando);
      if (e.tipo === 'resultado' && !e.resultado.omitido && (e.resultado.enviadas > 0 || e.resultado.rechazadas > 0)) setUltimo(e.resultado);
      void leer();
    });
  }, [leer]);

  const sincronizarAhora = useCallback(async () => {
    if (!uid) return null;
    return cola.sincronizar(uid);
  }, [uid]);

  return { ...n, sincronizando, ultimo, sincronizarAhora };
}

/**
 * Envía los pendientes sin que nadie lo pida: al abrir la aplicación, al volver la señal, al volver a la pestaña
 * y cada 60 segundos. No dibuja nada.
 */
export function Sincronizador() {
  const { perfil } = useAuth();
  const online = useOnline();
  const uid = perfil?.activo ? perfil.user_id : undefined;
  const enviar = useRef<() => void>(() => undefined);
  enviar.current = () => {
    if (uid && navigator.onLine) void cola.sincronizar(uid);
  };

  useEffect(() => { enviar.current(); }, [uid, online]);
  useEffect(() => {
    const t = setInterval(() => enviar.current(), INTERVALO_SINCRONIZACION_MS);
    const visible = () => { if (document.visibilityState === 'visible') enviar.current(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return null;
}
