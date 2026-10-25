import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthContext';
import { Alerta, Modal } from '../../core/ui';
import { PesoInput } from '../../lib/unidades';
import { aApiError } from '../../lib/errores';
import { hoyEcuador } from '../../lib/fechas';
import { Campo, CampoTexto } from './controles';
import CampoLote from './CampoLote';
import SelectorCatalogo from './SelectorCatalogo';
import PanelCalculos from './PanelCalculos';
import { guardarRecepcion, obtenerConfig } from './api';
import { aPayload, validarRecepcion } from './esquema';
import { FORMATO_LOTE_POR_DEFECTO, type CampoForm, type Errores, type FormRecepcion, type InfoLote, type RespuestaGuardar } from './tipos';

const ORDEN_CAMPOS: CampoForm[] = [
  'fecha_llegada', 'placa_vehiculo', 'lote_id', 'proveedor', 'especie', 'piscina', 'guia_remision', 'num_gavetas_bines',
  'libras_reportadas', 'libras_planta', 'hora_inicio_descarga', 'hora_fin_descarga', 'observacion',
];

const vacio = (): FormRecepcion => ({
  fecha_llegada: hoyEcuador(), placa_vehiculo: '', lote_id: '', proveedor: '', especie: '', piscina: '', guia_remision: '',
  num_gavetas_bines: '', libras_reportadas: null, libras_planta: null, hora_inicio_descarga: '', hora_fin_descarga: '',
  observacion: '', gavetas: [], temperaturas: [], almacenamiento: [],
});

type Mensaje = { tipo: 'exito' | 'error' | 'aviso'; texto: string } | null;

/** Formulario de recepción, Parte 6: datos generales, lote y cierre. Gavetas, temperaturas y almacenamiento llegan en la Parte 7. */
export default function FormularioRecepcion() {
  const { perfil } = useAuth();
  const [f, setF] = useState<FormRecepcion>(vacio);
  const [errores, setErrores] = useState<Errores>({});
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [guardando, setGuardando] = useState(false);
  const [sucio, setSucio] = useState(false);
  const [meta, setMeta] = useState<{ id: string; version: number } | null>(null);
  const [cerrada, setCerrada] = useState<RespuestaGuardar | null>(null);
  const [infoLote, setInfoLote] = useState<InfoLote | null>(null);
  const [formatoLote, setFormatoLote] = useState(FORMATO_LOTE_POR_DEFECTO);
  const clientUuid = useRef<string>(crypto.randomUUID());
  const proveedorHeredado = useRef(false);

  // Formato del lote desde la configuración de la base de datos (si no hay red, se usa el de fábrica).
  useEffect(() => {
    let vivo = true;
    obtenerConfig().then((c) => { if (vivo && c.formato_lote) setFormatoLote(c.formato_lote); }).catch(() => { /* se usa el de fábrica */ });
    return () => { vivo = false; };
  }, []);

  // Aviso al salir con cambios sin guardar (cierre de pestaña y navegación interna).
  useEffect(() => {
    if (!sucio) return;
    const antes = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', antes);
    return () => window.removeEventListener('beforeunload', antes);
  }, [sucio]);
  const bloqueo = useBlocker(({ currentLocation, nextLocation }) => sucio && currentLocation.pathname !== nextLocation.pathname);

  const cambiar = useCallback(<K extends keyof FormRecepcion>(campo: K, valor: FormRecepcion[K]) => {
    setF((p) => ({ ...p, [campo]: valor }));
    setSucio(true);
    setMensaje(null);
    setErrores((e) => ({ ...e, [campo]: undefined, general: undefined }));
  }, []);

  // El lote existente fija el proveedor (y propone la especie); al cambiar de lote se libera.
  const recibirInfoLote = useCallback((info: InfoLote | null) => {
    setInfoLote(info);
    if (info?.existe) {
      proveedorHeredado.current = true;
      setF((p) => ({ ...p, proveedor: info.proveedor_nombre ?? p.proveedor, especie: p.especie.trim() === '' && info.especie_nombre ? info.especie_nombre : p.especie }));
    } else if (proveedorHeredado.current) {
      proveedorHeredado.current = false;
      setF((p) => ({ ...p, proveedor: '' }));
    }
  }, []);

  const guardar = async (estado: 'borrador' | 'cerrado') => {
    const loteExiste = infoLote ? infoLote.existe : null;
    const errs = validarRecepcion(f, { formatoLote, hoy: hoyEcuador(), cerrando: estado === 'cerrado', loteExiste });
    const claves = Object.keys(errs) as CampoForm[];
    if (claves.length > 0) {
      setErrores(errs);
      setMensaje({ tipo: 'error', texto: 'Revisa los campos marcados en rojo.' });
      const primero = ORDEN_CAMPOS.find((c) => errs[c]);
      if (primero) document.getElementById(primero)?.focus();
      return;
    }
    setErrores({});
    setMensaje(null);
    setGuardando(true);
    try {
      const r = await guardarRecepcion(aPayload(f, {
        client_uuid: clientUuid.current, estado, loteExiste,
        recepcion_id: meta?.id, version: meta?.version,
      }));
      setMeta({ id: r.recepcion_id, version: r.version });
      setSucio(false);
      if (estado === 'cerrado') setCerrada(r);
      else setMensaje({ tipo: 'exito', texto: `Borrador guardado como ${r.recepcion_id}. Puedes seguir completando y volver a guardar.` });
    } catch (e) {
      const err = aApiError(e);
      if (err.codigo === 'E_DUPLICADO') {
        setErrores({ guia_remision: err.message });
        setMensaje({ tipo: 'error', texto: err.message });
        document.getElementById('guia_remision')?.focus();
      } else if (err.codigo === 'E_RED') {
        setMensaje({ tipo: 'error', texto: 'Sin conexión: no se guardó. Tus datos siguen en la pantalla; intenta de nuevo cuando tengas señal.' });
      } else {
        setMensaje({ tipo: 'error', texto: err.message });
      }
    } finally {
      setGuardando(false);
    }
  };

  const reiniciar = () => {
    clientUuid.current = crypto.randomUUID();
    proveedorHeredado.current = false;
    setF(vacio()); setErrores({}); setMensaje(null); setSucio(false); setMeta(null); setCerrada(null); setInfoLote(null);
  };

  if (cerrada) {
    return (
      <>
        <h1>Recepción cerrada</h1>
        <Alerta tipo="exito">La recepción <strong>{cerrada.recepcion_id}</strong> se guardó y quedó cerrada.</Alerta>
        <div className="acciones-fila">
          <button className="boton-primario" onClick={reiniciar}>Registrar otra recepción</button>
          <Link className="boton-secundario enlace-boton" to="/m01">Volver a Recepción</Link>
        </div>
      </>
    );
  }

  const heredado = infoLote?.existe === true;
  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate aria-label="Formulario de recepción">
      <h1>Nueva recepción</h1>
      <p className="texto-suave">
        Control de pesos en recepción pesca crustáceos.
        {meta && <> Guardada como borrador: <strong>{meta.id}</strong>.</>}
      </p>
      {mensaje && <Alerta tipo={mensaje.tipo}>{mensaje.texto}</Alerta>}
      {errores.general && <Alerta tipo="aviso">{errores.general}</Alerta>}

      <section className="tarjeta tarjeta-ancha" aria-labelledby="sec1">
        <h2 id="sec1">1. Datos generales</h2>
        <div className="rejilla-form">
          <CampoTexto id="fecha_llegada" etiqueta="Fecha de llegada" tipo="date" obligatorio value={f.fecha_llegada}
                      onChange={(v) => cambiar('fecha_llegada', v)} error={errores.fecha_llegada} />
          <CampoTexto id="placa_vehiculo" etiqueta="Placa del vehículo" mayusculas value={f.placa_vehiculo}
                      onChange={(v) => cambiar('placa_vehiculo', v)} error={errores.placa_vehiculo} maxLength={20} />
          <CampoLote value={f.lote_id} onChange={(v) => cambiar('lote_id', v)} formatoLote={formatoLote}
                     error={errores.lote_id} onInfo={recibirInfoLote} />
          <SelectorCatalogo id="proveedor" etiqueta="Proveedor" tipo="proveedores" obligatorio value={f.proveedor}
                            onChange={(v) => cambiar('proveedor', v)} error={errores.proveedor} bloqueado={heredado}
                            ayudaBloqueado="Tomado del lote existente." />
          <SelectorCatalogo id="especie" etiqueta="Especie" tipo="especies" obligatorio value={f.especie}
                            onChange={(v) => cambiar('especie', v)} error={errores.especie} />
          <CampoTexto id="piscina" etiqueta="Piscina" value={f.piscina} onChange={(v) => cambiar('piscina', v)}
                      error={errores.piscina} maxLength={40} />
          <CampoTexto id="guia_remision" etiqueta="Guía de remisión" obligatorio value={f.guia_remision}
                      onChange={(v) => cambiar('guia_remision', v)} error={errores.guia_remision} maxLength={60} />
          <CampoTexto id="num_gavetas_bines" etiqueta="N.º de gavetas o bines" obligatorio modo="numeric" value={f.num_gavetas_bines}
                      onChange={(v) => cambiar('num_gavetas_bines', v.replace(/\D/g, ''))} error={errores.num_gavetas_bines} maxLength={4} />
          <PesoInput id="libras_reportadas" etiqueta="Libras reportadas" value={f.libras_reportadas}
                     onChange={(v) => cambiar('libras_reportadas', v)} error={errores.libras_reportadas} />
          <PesoInput id="libras_planta" etiqueta="Libras de planta" value={f.libras_planta}
                     onChange={(v) => cambiar('libras_planta', v)} error={errores.libras_planta} />
          <CampoTexto id="hora_inicio_descarga" etiqueta="Hora de inicio de descarga" tipo="time" value={f.hora_inicio_descarga}
                      onChange={(v) => cambiar('hora_inicio_descarga', v)} error={errores.hora_inicio_descarga} />
          <CampoTexto id="hora_fin_descarga" etiqueta="Hora de fin de descarga" tipo="time" value={f.hora_fin_descarga}
                      onChange={(v) => cambiar('hora_fin_descarga', v)} error={errores.hora_fin_descarga} />
        </div>
      </section>

      <PanelCalculos f={f} />

      <section className="tarjeta tarjeta-ancha tarjeta-pendiente" aria-labelledby="sec24">
        <h2 id="sec24">2 a 4. Gavetas, temperaturas y almacenamiento</h2>
        <p className="texto-suave">Estas secciones se activan en la Parte 7. Por ahora la recepción se guarda como borrador con los datos generales.</p>
      </section>

      <section className="tarjeta tarjeta-ancha" aria-labelledby="sec5">
        <h2 id="sec5">5. Cierre</h2>
        <div className="rejilla-form">
          <Campo id="observacion" etiqueta="Observación" error={errores.observacion}>
            <textarea id="observacion" rows={3} value={f.observacion} maxLength={2000}
                      aria-invalid={Boolean(errores.observacion)} aria-describedby={errores.observacion ? 'observacion-error' : undefined}
                      onChange={(e) => cambiar('observacion', e.target.value)} />
          </Campo>
          <Campo id="realizado_por" etiqueta="Realizado por">
            <input id="realizado_por" type="text" readOnly value={perfil?.nombre?.trim() || perfil?.correo || ''} />
          </Campo>
        </div>
      </section>

      <div className="barra-acciones">
        <Link className="boton-secundario enlace-boton" to="/m01">Salir</Link>
        <button type="button" className="boton-secundario" disabled={guardando} onClick={() => void guardar('borrador')}>
          {guardando ? 'Guardando…' : 'Guardar borrador'}
        </button>
        <button type="button" className="boton-primario" disabled={guardando} onClick={() => void guardar('cerrado')}>
          Guardar y cerrar
        </button>
      </div>

      {bloqueo.state === 'blocked' && (
        <Modal titulo="Tienes cambios sin guardar" onCerrar={() => bloqueo.reset()}
               acciones={<>
                 <button type="button" className="boton-secundario" onClick={() => bloqueo.proceed()}>Salir sin guardar</button>
                 <button type="button" className="boton-primario" onClick={() => bloqueo.reset()}>Seguir editando</button>
               </>}>
          <p>Si sales ahora, se pierden los datos que escribiste en esta recepción.</p>
        </Modal>
      )}
    </form>
  );
}
