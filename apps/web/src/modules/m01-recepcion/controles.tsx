import type { ReactNode } from 'react';

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
}

export function CampoTexto({ id, etiqueta, value, onChange, error, ayuda, obligatorio, tipo = 'text', modo, maxLength, placeholder, mayusculas }: TextoProps) {
  return (
    <Campo id={id} etiqueta={etiqueta} error={error} ayuda={ayuda} obligatorio={obligatorio}>
      <input
        id={id} type={tipo} value={value} inputMode={modo} maxLength={maxLength} placeholder={placeholder}
        autoComplete="off" autoCapitalize={mayusculas ? 'characters' : 'off'}
        aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} aria-required={obligatorio}
        onChange={(e) => onChange(mayusculas ? e.target.value.toUpperCase() : e.target.value)}
      />
    </Campo>
  );
}
