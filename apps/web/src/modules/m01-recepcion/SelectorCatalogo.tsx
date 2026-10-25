import { useEffect, useState } from 'react';
import { Campo } from './controles';
import { listarCatalogo } from './api';
import { hayCoincidenciaExacta, normalizar, parecidos } from '../../lib/texto';

interface Props {
  id: string;
  etiqueta: string;
  tipo: 'proveedores' | 'especies';
  value: string;
  onChange: (v: string) => void;
  error?: string;
  obligatorio?: boolean;
  /** Campo bloqueado (por ejemplo el proveedor heredado del lote). */
  bloqueado?: boolean;
  ayudaBloqueado?: string;
}

/**
 * Campo de texto con sugerencias del catálogo. Si el nombre no existe, se agregará al guardar
 * («alta al escribir»); si se parece a uno existente, avisa por si fue un error de digitación.
 */
export default function SelectorCatalogo({ id, etiqueta, tipo, value, onChange, error, obligatorio, bloqueado, ayudaBloqueado }: Props) {
  const [nombres, setNombres] = useState<string[]>([]);
  const [consultado, setConsultado] = useState(false);
  const [sinRed, setSinRed] = useState(false);

  useEffect(() => {
    if (bloqueado) return;
    const texto = value.trim();
    if (texto.length < 2) { setNombres([]); setConsultado(false); return; }
    let vigente = true;
    const t = setTimeout(async () => {
      try {
        const r = await listarCatalogo(tipo, texto);
        if (!vigente) return;
        setNombres(r.map((x) => x.nombre)); setConsultado(true); setSinRed(false);
      } catch {
        if (!vigente) return;
        setNombres([]); setConsultado(false); setSinRed(true);
      }
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [value, tipo, bloqueado]);

  const texto = value.trim();
  const exacto = hayCoincidenciaExacta(texto, nombres);
  const similares = parecidos(texto, nombres);
  const sugerencias = nombres.filter((n) => normalizar(n) !== normalizar(texto)).slice(0, 6);
  const nuevo = !bloqueado && texto.length >= 2 && consultado && !exacto;

  return (
    <Campo id={id} etiqueta={etiqueta} error={error} obligatorio={obligatorio}
           ayuda={bloqueado ? ayudaBloqueado : undefined}>
      <input
        id={id} type="text" value={value} disabled={bloqueado} autoComplete="off"
        aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} aria-required={obligatorio}
        onChange={(e) => onChange(e.target.value)}
      />
      {!bloqueado && texto.length >= 2 && (
        <div className="catalogo-estado" aria-live="polite">
          {exacto && <p className="aviso-campo aviso-ok">Existe en el catálogo.</p>}
          {nuevo && similares.length === 0 && <p className="aviso-campo aviso-nuevo">«{texto}» es nuevo y se agregará al guardar.</p>}
          {similares.length > 0 && (
            <div className="aviso-campo aviso-parecido">
              <p>Se parece a un nombre que ya existe. ¿Es el mismo? Tócalo para usarlo:</p>
              <div className="chips">
                {similares.map((s) => <button type="button" key={s} className="chip" onClick={() => onChange(s)}>{s}</button>)}
              </div>
              <p className="ayuda">Si es otro distinto, déjalo como está y se agregará como nuevo.</p>
            </div>
          )}
          {sugerencias.length > 0 && similares.length === 0 && (
            <div className="chips" aria-label="Sugerencias">
              {sugerencias.map((s) => <button type="button" key={s} className="chip" onClick={() => onChange(s)}>{s}</button>)}
            </div>
          )}
          {sinRed && <p className="ayuda">Sin conexión: no se pueden mostrar sugerencias. Si el nombre no existe, se agregará al guardar.</p>}
        </div>
      )}
    </Campo>
  );
}
