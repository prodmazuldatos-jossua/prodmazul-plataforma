import { useCallback, useEffect, useState } from 'react';
import { Alerta, Cargando } from '../ui';
import { Icono } from '../iconos';
import { mensajeDe } from '../../lib/errores';
import { formatoFechaHora } from '../../lib/fechas';
import { cambiarConfig, listarConfig, type ParametroConfig } from './api';
import { esIgual, textoValor, validarParametro } from './administracion';

type Aviso = { tipo: 'exito' | 'aviso' | 'error'; texto: string } | null;

function Fila({ p, onGuardado, onError }: { p: ParametroConfig; onGuardado: (t: string) => void; onError: (t: string) => void }) {
  const [texto, setTexto] = useState(textoValor(p.valor));
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setTexto(textoValor(p.valor)); }, [p.valor]);
  const v = validarParametro(p, texto);
  const cambiado = v.ok ? !esIgual(v.valor, p.valor) : texto.trim() !== textoValor(p.valor);
  const rango = p.tipo === 'regex' ? null : `Entre ${p.min} y ${p.max}`;
  const guardar = async () => {
    if (!v.ok || !cambiado) return;
    setGuardando(true);
    try { await cambiarConfig(p.clave, v.valor); onGuardado(`«${p.etiqueta}» guardado: ${v.valor}.`); }
    catch (e) { onError(mensajeDe(e)); }
    finally { setGuardando(false); }
  };
  const id = `cfg-${p.clave}`;
  return (
    <section className="tarjeta tarjeta-ancha parametro" aria-label={p.etiqueta} data-testid={`param-${p.clave}`}>
      <div className="campo">
        <label htmlFor={id}>{p.etiqueta}</label>
        <div className="campo-con-boton">
          <input id={id} value={texto} inputMode={p.tipo === 'regex' ? 'text' : 'decimal'} autoComplete="off" spellCheck={false}
                 aria-invalid={!v.ok && cambiado} aria-describedby={`${id}-ayuda`} onChange={(e) => setTexto(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void guardar(); } }} />
          <button type="button" className="boton-primario" disabled={guardando || !cambiado || !v.ok} onClick={() => void guardar()}>
            <Icono nombre="guardar" />{guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
        {!v.ok && cambiado && <p className="error-campo" role="alert">{v.error}</p>}
      </div>
      <p className="ayuda" id={`${id}-ayuda`}>{p.ayuda}{rango ? ` ${rango}.` : ''}</p>
      <p className="ayuda">
        Valor de fábrica: <code>{textoValor(p.defecto)}</code>
        {!esIgual(textoValor(p.defecto), texto.trim()) && <> · <button type="button" className="boton-enlace" onClick={() => setTexto(textoValor(p.defecto))}>Poner el de fábrica</button></>}
      </p>
      {p.cambiado_en && <p className="ayuda">Último cambio: {formatoFechaHora(p.cambiado_en)}{p.cambiado_por ? ` · ${p.cambiado_por}` : ''}</p>}
    </section>
  );
}

export default function PaginaConfiguracion() {
  const [params, setParams] = useState<ParametroConfig[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const cargar = useCallback(async () => {
    try { setParams(await listarConfig()); setError(null); } catch (e) { setError(mensajeDe(e)); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div>
      <div className="encabezado-lista"><h1>Configuración</h1></div>
      <p className="texto-suave">Cada cambio se valida antes de guardarse y queda en la auditoría con el valor anterior y el nuevo. Los interruptores del envío a Sheets y de la purga de fotos no están aquí: se activan con las guías.</p>
      {aviso && <Alerta tipo={aviso.tipo}>{aviso.texto}</Alerta>}
      {error && <Alerta tipo="error">{error}</Alerta>}
      {!params && !error && <Cargando />}
      {params?.map((p) => (
        <Fila key={p.clave} p={p} onGuardado={(t) => { setAviso({ tipo: 'exito', texto: t }); void cargar(); }} onError={(t) => setAviso({ tipo: 'error', texto: t })} />
      ))}
    </div>
  );
}
