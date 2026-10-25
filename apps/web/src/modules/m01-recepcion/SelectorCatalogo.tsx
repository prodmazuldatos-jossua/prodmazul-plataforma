import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Campo } from './controles';
import { listarCatalogo } from './api';
import { completar, hayCoincidenciaExacta, nombreOficial, normalizar, parecidos } from '../../lib/texto';

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
  const entrada = useRef<HTMLInputElement>(null);
  const borrando = useRef(false);                 // si la última tecla fue Borrar, no se vuelve a completar
  const seleccion = useRef<{ inicio: number; fin: number } | null>(null);

  // Tras autocompletar, lo agregado queda seleccionado: seguir escribiendo lo reemplaza; Borrar lo quita.
  useLayoutEffect(() => {
    const s = seleccion.current;
    if (s && entrada.current) { entrada.current.setSelectionRange(s.inicio, s.fin); seleccion.current = null; }
  }, [value]);

  useEffect(() => {
    if (bloqueado) return;
    const texto = value.trim();
    if (texto.length < 2) { setNombres([]); setConsultado(false); return; }
    let vigente = true;
    const t = setTimeout(async () => {
      try {
        const r = await listarCatalogo(tipo, texto);
        if (!vigente) return;
        const lista = r.map((x) => x.nombre);
        setNombres(lista); setConsultado(true); setSinRed(false);
        // Autocompletar: si lo escrito es el comienzo de un nombre existente, se completa (solo si el campo está en uso).
        const completo = completar(texto, lista);
        if (completo && !borrando.current && document.activeElement === entrada.current && entrada.current?.value.trim() === texto) {
          seleccion.current = { inicio: entrada.current.value.length, fin: completo.length };
          onChange(completo);
        }
      } catch {
        if (!vigente) return;
        setNombres([]); setConsultado(false); setSinRed(true);
      }
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, tipo, bloqueado]);

  // Al salir del campo, si coincide con un nombre existente (aunque cambien mayúsculas o tildes) se usa su escritura oficial.
  const aplicarNombreOficial = async () => {
    const escrito = value.trim();
    if (bloqueado || escrito.length < 2) return;
    let lista = nombres;
    if (!nombreOficial(escrito, lista)) {
      try { lista = (await listarCatalogo(tipo, escrito)).map((x) => x.nombre); } catch { return; }
    }
    const oficial = nombreOficial(escrito, lista);
    if (oficial && oficial !== value) onChange(oficial);
  };

  const texto = value.trim();
  const exacto = hayCoincidenciaExacta(texto, nombres);
  const similares = parecidos(texto, nombres);
  const sugerencias = nombres.filter((n) => normalizar(n) !== normalizar(texto)).slice(0, 6);
  const nuevo = !bloqueado && texto.length >= 2 && consultado && !exacto;

  return (
    <Campo id={id} etiqueta={etiqueta} error={error} obligatorio={obligatorio}
           ayuda={bloqueado ? ayudaBloqueado : undefined}>
      <input
        id={id} ref={entrada} type="text" value={value} disabled={bloqueado} autoComplete="off"
        aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} aria-required={obligatorio}
        onKeyDown={(e) => { borrando.current = e.key === 'Backspace' || e.key === 'Delete'; }}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => void aplicarNombreOficial()}
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
