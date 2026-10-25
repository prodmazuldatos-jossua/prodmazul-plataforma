import { useEffect, useRef, useState } from 'react';
import { Campo } from './controles';
import { obtenerLote } from './api';
import { loteValido } from './esquema';
import type { InfoLote } from './tipos';
import { useUnidad } from '../../lib/unidades';
import { mensajeDe } from '../../lib/errores';

interface Props {
  value: string;
  onChange: (v: string) => void;
  formatoLote: string;
  error?: string;
  /** El formulario recibe lo que se sabe del lote: info (existente o nuevo) o null si aún no hay un lote válido. */
  onInfo: (info: InfoLote | null) => void;
}

/** Campo de lote: valida el formato, consulta si existe y muestra camiones y libras acumulados. */
export default function CampoLote({ value, onChange, formatoLote, error, onInfo }: Props) {
  const { texto: peso } = useUnidad();
  const [info, setInfo] = useState<InfoLote | null>(null);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const aviso = useRef(onInfo);
  aviso.current = onInfo;

  useEffect(() => {
    const lote = value.trim().toUpperCase();
    if (!loteValido(lote, formatoLote)) { setInfo(null); setFallo(null); setCargando(false); aviso.current(null); return; }
    let vigente = true;
    setCargando(true);
    const t = setTimeout(async () => {
      try {
        const r = await obtenerLote(lote);
        if (!vigente) return;
        setInfo(r); setFallo(null); aviso.current(r);
      } catch (e) {
        if (!vigente) return;
        setInfo(null); setFallo(mensajeDe(e)); aviso.current(null);
      } finally {
        if (vigente) setCargando(false);
      }
    }, 350);
    return () => { vigente = false; clearTimeout(t); };
  }, [value, formatoLote]);

  return (
    <Campo id="lote_id" etiqueta="Lote" obligatorio error={error}
           ayuda="3 grupos separados por guion, por ejemplo 123-456-789 o 123-456A-789.">
      <input
        id="lote_id" type="text" value={value} autoComplete="off" autoCapitalize="characters" placeholder="123-456-789"
        aria-invalid={Boolean(error)} aria-describedby={error ? 'lote_id-error' : undefined} aria-required
        onChange={(e) => onChange(e.target.value.toUpperCase())}
      />
      <div aria-live="polite">
        {cargando && <p className="ayuda">Consultando el lote…</p>}
        {!cargando && info && info.existe && (
          <div className="aviso-campo aviso-lote" data-testid="lote-existente">
            <p><strong>Lote existente.</strong> Ya tiene {info.camiones} {info.camiones === 1 ? 'camión' : 'camiones'} registrados.</p>
            <p>Libras reportadas acumuladas: <strong>{peso(info.libras_reportadas)}</strong> · Libras de planta acumuladas: <strong>{peso(info.libras_planta)}</strong></p>
            <p className="ayuda">El proveedor se toma del lote y no se puede cambiar aquí.</p>
          </div>
        )}
        {!cargando && info && !info.existe && (
          <p className="aviso-campo aviso-nuevo" data-testid="lote-nuevo">Lote nuevo: se creará al guardar. Escribe su proveedor.</p>
        )}
        {fallo && <p className="ayuda">No se pudo consultar el lote ({fallo}). Se verificará al guardar.</p>}
      </div>
    </Campo>
  );
}
