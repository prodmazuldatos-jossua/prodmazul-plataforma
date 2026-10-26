import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { obtenerResumen } from './api';
import { mensajeDe } from '../../lib/errores';
import { nivelActual, textoIndicador, type Nivel, type ResumenRespaldo } from './respaldo';

const CADA_MS = 60_000;      // se consulta al servidor cada minuto (solo con la pantalla visible)
const LATIDO_MS = 15_000;    // «hace X minutos» se recalcula cada 15 segundos sin llamar al servidor

export interface CtxRespaldo {
  /** null = todavía no hay datos (o la persona no administra). */
  resumen: ResumenRespaldo | null;
  recibidoMs: number;
  ahoraMs: number;
  nivel: Nivel | null;
  texto: string;
  error: string | null;
  cargando: boolean;
  recargar: () => Promise<void>;
}

export const RespaldoContext = createContext<CtxRespaldo | null>(null);

/** Mantiene al día el estado del respaldo. Solo trabaja si `habilitado` (quienes administran); si no, no llama a nada. */
export function RespaldoProvider({ habilitado, children }: { habilitado: boolean; children: ReactNode }) {
  const [resumen, setResumen] = useState<ResumenRespaldo | null>(null);
  const [recibidoMs, setRecibidoMs] = useState(0);
  const [ahoraMs, setAhoraMs] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const enCurso = useRef(false);

  const recargar = useCallback(async () => {
    if (!habilitado || enCurso.current) return;
    enCurso.current = true;
    setCargando(true);
    try {
      const r = await obtenerResumen();
      setResumen(r);
      setRecibidoMs(Date.now());
      setError(null);
    } catch (e) {
      // Sin señal o con error se conserva el último dato conocido (el reloj sigue avanzando).
      setError(mensajeDe(e));
    } finally {
      enCurso.current = false;
      setCargando(false);
      setAhoraMs(Date.now());
    }
  }, [habilitado]);

  useEffect(() => {
    if (!habilitado) { setResumen(null); setError(null); return; }
    void recargar();
    const consulta = window.setInterval(() => { if (document.visibilityState === 'visible') void recargar(); }, CADA_MS);
    const alVolver = () => { if (document.visibilityState === 'visible') void recargar(); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('online', alVolver);
    return () => {
      window.clearInterval(consulta);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('online', alVolver);
    };
  }, [habilitado, recargar]);

  useEffect(() => {
    if (!habilitado) return;
    const latido = window.setInterval(() => setAhoraMs(Date.now()), LATIDO_MS);
    return () => window.clearInterval(latido);
  }, [habilitado]);

  const valor = useMemo<CtxRespaldo>(() => ({
    resumen, recibidoMs, ahoraMs, error, cargando, recargar,
    nivel: resumen ? nivelActual(resumen, recibidoMs, ahoraMs) : null,
    texto: resumen ? textoIndicador(resumen, recibidoMs, ahoraMs) : '',
  }), [resumen, recibidoMs, ahoraMs, error, cargando, recargar]);

  return <RespaldoContext.Provider value={valor}>{children}</RespaldoContext.Provider>;
}

export function useRespaldo(): CtxRespaldo {
  const c = useContext(RespaldoContext);
  if (!c) throw new Error('useRespaldo debe usarse dentro de RespaldoProvider');
  return c;
}
