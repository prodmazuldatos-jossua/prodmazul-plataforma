import { useEffect, useRef, useState, type ReactNode } from 'react';

interface CampoProps { id: string; etiqueta: string; error?: string; ayuda?: string; obligatorio?: boolean; children: ReactNode }

/** Contenedor de un campo: etiqueta, control, ayuda y mensaje de error. */
export function Campo({ id, etiqueta, error, ayuda, obligatorio, children }: CampoProps) {
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}{obligatorio && <span className="obligatorio" aria-hidden="true"> *</span>}</label>
      {children}
      {ayuda && !error && <p className="ayuda">{ayuda}</p>}
      {error && <p className="error-campo" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

interface TextoProps {
  id: string; etiqueta: string; value: string; onChange: (v: string) => void; error?: string; ayuda?: string; obligatorio?: boolean;
  tipo?: 'text' | 'date' | 'time'; modo?: 'text' | 'numeric'; maxLength?: number; placeholder?: string; mayusculas?: boolean;
  /** Campo que no se puede modificar (por ejemplo, la fecha al editar una recepción ya guardada). */
  deshabilitado?: boolean;
}

export function CampoTexto({ id, etiqueta, value, onChange, error, ayuda, obligatorio, tipo = 'text', modo, maxLength, placeholder, mayusculas, deshabilitado }: TextoProps) {
  return (
    <Campo id={id} etiqueta={etiqueta} error={error} ayuda={ayuda} obligatorio={obligatorio}>
      <input
        id={id} type={tipo} value={value} inputMode={modo} maxLength={maxLength} placeholder={placeholder} disabled={deshabilitado}
        autoComplete="off" autoCapitalize={mayusculas ? 'characters' : 'off'}
        aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} aria-required={obligatorio}
        onChange={(e) => onChange(mayusculas ? e.target.value.toUpperCase() : e.target.value)}
      />
    </Campo>
  );
}

interface TemperaturaProps {
  id: string; value: number | null; onChange: (v: number | null) => void; error?: string; etiqueta?: string; etiquetaAria?: string;
}

/** Siempre con un decimal: -3.0, 2.5, 0.0 (igual que se guarda). */
export const formatoTemp = (v: number | null) => (v === null ? '' : v.toFixed(1));

/**
 * Temperatura en °C con botón ± (los teclados numéricos de las tabletas no traen el signo menos).
 * Acepta un decimal; el valor se guarda redondeado a 1 decimal.
 */
export function TemperaturaInput({ id, value, onChange, error, etiqueta, etiquetaAria }: TemperaturaProps) {
  const [texto, setTexto] = useState(formatoTemp(value));
  const enfocado = useRef(false);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!enfocado.current) setTexto(formatoTemp(value));
  }, [value]);

  const cambiar = (t: string) => {
    const limpio = t.replace(',', '.');
    if (!/^-?\d*\.?\d*$/.test(limpio)) return;
    setTexto(limpio);
    if (limpio === '' || limpio === '-' || limpio === '.' || limpio === '-.') onChange(null);
    else onChange(Math.round(Number(limpio) * 10) / 10);
  };
  const cambiarSigno = () => {
    enfocado.current = true;
    cambiar(texto.startsWith('-') ? texto.slice(1) : `-${texto}`);
    entrada.current?.focus();
  };

  return (
    <div className="campo campo-compacto">
      {etiqueta && <label htmlFor={id}>{etiqueta} <span className="unidad-etiqueta">(°C)</span></label>}
      <div className="campo-con-boton">
        <input
          id={id} ref={entrada} type="text" inputMode="decimal" autoComplete="off" value={texto} placeholder="°C"
          aria-label={etiqueta ? undefined : etiquetaAria} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
          onFocus={() => { enfocado.current = true; }}
          onBlur={() => { enfocado.current = false; setTexto(formatoTemp(value)); }}
          onChange={(e) => cambiar(e.target.value)}
        />
        <button type="button" className="boton-secundario boton-signo" aria-label="Cambiar signo (más o menos)" onClick={cambiarSigno}>±</button>
      </div>
      {error && <p className="error-campo" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

interface ConmutadorProps<T extends string> {
  opciones: { valor: T; texto: string }[];
  valor: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  idBase: string;
  /** Versión más pequeña, para ponerlo al lado de otro elemento. */
  compacto?: boolean;
}

/** Interruptor de dos (o más) opciones, grande y táctil, con el mismo aspecto que Lb / Kg. */
export function Conmutador<T extends string>({ opciones, valor, onChange, ariaLabel, idBase, compacto }: ConmutadorProps<T>) {
  return (
    <div className={`interruptor${compacto ? ' interruptor-compacto' : ''}`} role="group" aria-label={ariaLabel}>
      {opciones.map((o) => (
        <button type="button" key={o.valor} id={`${idBase}-${o.valor}`} className={valor === o.valor ? 'activo' : ''}
                aria-pressed={valor === o.valor} onClick={() => onChange(o.valor)}>{o.texto}</button>
      ))}
    </div>
  );
}
