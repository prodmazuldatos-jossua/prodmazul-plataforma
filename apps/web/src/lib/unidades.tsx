import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type Unidad = 'lb' | 'kg';
export const FACTOR_LB_KG = 2.20462;

export function lbAKg(lb: number): number { return lb / FACTOR_LB_KG; }
export function kgALb(kg: number): number { return kg * FACTOR_LB_KG; }

interface Ctx {
  unidad: Unidad;
  setUnidad: (u: Unidad) => void;
  /** Convierte libras guardadas al valor que se muestra en la unidad elegida. */
  aMostrar: (lb: number | null | undefined) => number | null;
  /** Convierte lo que escribió la persona (en la unidad elegida) a libras. */
  aLibras: (valor: number) => number;
  /** Texto con 2 decimales y la unidad, p. ej. "1,234.50 lb". */
  texto: (lb: number | null | undefined, conUnidad?: boolean) => string;
}

const UnidadContext = createContext<Ctx | null>(null);
const CLAVE = 'prodmazul_unidad';

export function UnidadProvider({ children }: { children: ReactNode }) {
  const [unidad, setU] = useState<Unidad>(() => (localStorage.getItem(CLAVE) === 'kg' ? 'kg' : 'lb'));
  const setUnidad = (u: Unidad) => { setU(u); try { localStorage.setItem(CLAVE, u); } catch { /* sin almacenamiento */ } };
  const aMostrar = (lb: number | null | undefined) => (lb === null || lb === undefined ? null : unidad === 'kg' ? lbAKg(lb) : lb);
  const aLibras = (v: number) => (unidad === 'kg' ? kgALb(v) : v);
  const texto = (lb: number | null | undefined, conUnidad = true) => {
    const v = aMostrar(lb);
    if (v === null) return '';
    const s = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
    return conUnidad ? `${s} ${unidad}` : s;
  };
  return <UnidadContext.Provider value={{ unidad, setUnidad, aMostrar, aLibras, texto }}>{children}</UnidadContext.Provider>;
}

export function useUnidad(): Ctx {
  const c = useContext(UnidadContext);
  if (!c) throw new Error('useUnidad debe usarse dentro de UnidadProvider');
  return c;
}

interface PesoInputProps {
  id: string;
  /** Valor en LIBRAS (lo que se guarda). */
  value: number | null;
  onChange: (lb: number | null) => void;
  etiqueta?: string;
  error?: string;
  placeholder?: string;
  compacto?: boolean;
}

/** Campo de peso: la persona escribe en la unidad elegida y el valor se guarda en libras. */
export function PesoInput({ id, value, onChange, etiqueta, error, placeholder, compacto }: PesoInputProps) {
  const { unidad, aMostrar, aLibras } = useUnidad();
  const formatear = (lb: number | null) => {
    const v = aMostrar(lb);
    return v === null ? '' : String(Math.round(v * 100) / 100);
  };
  const [texto, setTexto] = useState(formatear(value));
  const enfocado = useRef(false);

  useEffect(() => {
    if (!enfocado.current) setTexto(formatear(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, unidad]);

  const cambiar = (t: string) => {
    const limpio = t.replace(',', '.');
    if (limpio !== '' && !/^\d*\.?\d*$/.test(limpio)) return;
    setTexto(limpio);
    if (limpio === '' || limpio === '.') onChange(null);
    else onChange(Math.round(aLibras(Number(limpio)) * 100) / 100);
  };

  return (
    <div className={compacto ? 'campo campo-compacto' : 'campo'}>
      {etiqueta && <label htmlFor={id}>{etiqueta} <span className="unidad-etiqueta">({unidad})</span></label>}
      <input
        id={id} type="text" inputMode="decimal" autoComplete="off" value={texto} placeholder={placeholder}
        aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
        onFocus={() => { enfocado.current = true; }}
        onBlur={() => { enfocado.current = false; setTexto(formatear(value)); }}
        onChange={(e) => cambiar(e.target.value)}
      />
      {error && <p className="error-campo" id={`${id}-error`}>{error}</p>}
    </div>
  );
}
