import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthContext';
import { Alerta, Modal } from '../../core/ui';
import { PesoInput } from '../../lib/unidades';
import { aApiError } from '../../lib/errores';
import { hoyEcuador } from '../../lib/fechas';
import { Campo, CampoTexto, Conmutador } from './controles';
import { textoCantidad } from '../../lib/texto';
import CampoLote from './CampoLote';
import SelectorCatalogo from './SelectorCatalogo';
import NavSecciones from './NavSecciones';
import SeccionGavetas from './SeccionGavetas';
import SeccionTemperaturas from './SeccionTemperaturas';
import SeccionAlmacenamiento from './SeccionAlmacenamiento';
import PanelCalculos from './PanelCalculos';
import { guardarRecepcion, obtenerConfig } from './api';
import { recepcionAForm } from './mapeo';
import { aPayload, erroresPorSeccion, validarRecepcion } from './esquema';
import { FORMATO_LOTE_POR_DEFECTO, filaAlmacenamientoVacia, gavetasVacias, lecturasVacias, type CampoForm, type AlmacenamientoForm, type LecturaForm, type Errores, type FormRecepcion, type InfoLote, type RecepcionDetalle, type RespuestaGuardar } from './tipos';

const ORDEN_CAMPOS: CampoForm[] = [
  'fecha_llegada', 'placa_vehiculo', 'lote_id', 'proveedor', 'especie', 'piscina', 'guia_remision', 'num_gavetas_bines',
  'libras_reportadas', 'libras_planta', 'hora_inicio_descarga', 'hora_fin_descarga', 'observacion',
];

const vacio = (): FormRecepcion => ({
  fecha_llegada: hoyEcuador(), placa_vehiculo: '', lote_id: '', proveedor: '', especie: '', piscina: '', guia_remision: '',
  llegada_en: 'bines', num_gavetas_bines: '', libras_reportadas: null, libras_planta: null, hora_inicio_descarga: '', hora_fin_descarga: '',
  observacion: '', cerrar_lote: false, gavetas: gavetasVacias(), temperaturas: lecturasVacias(), almacenamiento: [filaAlmacenamientoVacia()],
});

type Mensaje = { tipo: 'exito' | 'error' | 'aviso'; texto: string } | null;

interface Props {
  /** Si se indica, el formulario edita esa recepción (borrador o cerrada) en lugar de crear una nueva. */
  inicial?: RecepcionDetalle;
  /** Vuelve a pedir la recepción a la base de datos (cuando otra persona la modificó). */
  onRecargar?: () => void;
}

/** Formulario de recepción completo: datos generales, gavetas, temperaturas, almacenamiento y cierre. */
export default function FormularioRecepcion({ inicial, onRecargar }: Props = {}) {
  const { perfil } = useAuth();
  const navigate = useNavigate();
  const editando = Boolean(inicial);
  const [f, setF] = useState<FormRecepcion>(() => (inicial ? recepcionAForm(inicial) : vacio()));
  const [errores, setErrores] = useState<Errores>({});
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [guardando, setGuardando] = useState(false);
  const [sucio, setSucio] = useState(false);
  const [meta, setMeta] = useState<{ id: string; version: number } | null>(inicial ? { id: inicial.recepcion_id, version: inicial.version } : null);
  const [conflicto, setConflicto] = useState(false);
  /** Lote en el que ya está guardada la recepción: ahí sigue permitido aunque el lote se haya cerrado. */
  const loteGuardado = useRef<string | null>(inicial ? inicial.lote_id : null);
  const salidaLibre = useRef(false);
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
  const bloqueo = useBlocker(({ currentLocation, nextLocation }) => sucio && !salidaLibre.current && currentLocation.pathname !== nextLocation.pathname);

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

  const cambiarGaveta = useCallback((i: number, lb: number | null) => {
    setF((p) => ({ ...p, gavetas: p.gavetas.map((g, k) => (k === i ? lb : g)) }));
    setSucio(true); setMensaje(null);
    setErrores((e) => (e.filas?.gavetas[i] || e.gavetas ? { ...e, gavetas: undefined, filas: e.filas && { ...e.filas, gavetas: { ...e.filas.gavetas, [i]: undefined as never } } } : e));
  }, []);
  const cambiarLecturas = useCallback((lecturas: LecturaForm[]) => {
    setF((p) => ({ ...p, temperaturas: lecturas }));
    setSucio(true); setMensaje(null);
    setErrores((e) => (e.filas ? { ...e, filas: { ...e.filas, lecturas: {} } } : e));
  }, []);
  const cambiarAlmacenamiento = useCallback((filas: AlmacenamientoForm[]) => {
    setF((p) => ({ ...p, almacenamiento: filas }));
    setSucio(true); setMensaje(null);
    setErrores((e) => (e.filas ? { ...e, filas: { ...e.filas, almacenamiento: {} } } : e));
  }, []);

  const guardar = async (estado: 'borrador' | 'cerrado') => {
    const loteExiste = infoLote ? infoLote.existe : null;
    const errs = validarRecepcion(f, { formatoLote, hoy: hoyEcuador(), cerrando: estado === 'cerrado', loteExiste, loteCerrado: infoLote?.cerrado === true && loteGuardado.current !== f.lote_id.trim().toUpperCase() });
    const hayErrores = ORDEN_CAMPOS.some((c) => errs[c]) || Boolean(errs.gavetas) || Boolean(errs.filas);
    if (hayErrores) {
      setErrores(errs);
      setMensaje({ tipo: 'error', texto: 'Revisa los campos marcados en rojo.' });
      const primero = ORDEN_CAMPOS.find((c) => errs[c]);
      if (primero) document.getElementById(primero)?.focus();
      else setTimeout(() => {
        const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
        else document.getElementById('seccion-gavetas')?.scrollIntoView({ block: 'start' });
      }, 0);
      return;
    }
    setErrores({});
    setMensaje(null);
    setConflicto(false);
    setGuardando(true);
    try {
      const r = await guardarRecepcion(aPayload(f, {
        client_uuid: clientUuid.current, estado, loteExiste,
        recepcion_id: meta?.id, version: meta?.version,
      }));
      setMeta({ id: r.recepcion_id, version: r.version });
      loteGuardado.current = f.lote_id.trim().toUpperCase();
      setSucio(false);
      if (editando && (estado === 'cerrado' || inicial?.estado === 'cerrado')) {
        salidaLibre.current = true;
        navigate(`/m01/${r.recepcion_id}`, { state: { aviso: r.lote_cerrado ? 'Cambios guardados. El lote quedó cerrado.' : 'Cambios guardados.' } });
      } else if (estado === 'cerrado') setCerrada(r);
      else setMensaje({ tipo: 'exito', texto: `Borrador guardado como ${r.recepcion_id}. Puedes seguir completando y volver a guardar.` });
    } catch (e) {
      const err = aApiError(e);
      if (err.codigo === 'E_DUPLICADO') {
        setErrores({ guia_remision: err.message });
        setMensaje({ tipo: 'error', texto: err.message });
        document.getElementById('guia_remision')?.focus();
      } else if (err.codigo === 'E_VERSION') {
        setConflicto(true);
        setMensaje({ tipo: 'error', texto: err.message });
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
        {cerrada.lote_cerrado
          ? <Alerta tipo="aviso">El lote <strong>{f.lote_id.trim().toUpperCase()}</strong> quedó <strong>cerrado</strong>: no admite más camiones.</Alerta>
          : <p className="texto-suave">El lote <strong>{f.lote_id.trim().toUpperCase()}</strong> sigue <strong>abierto</strong>: puede llegar otro camión.</p>}
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
      <h1>{editando ? `Editar recepción ${inicial?.recepcion_id}` : 'Nueva recepción'}</h1>
      <p className="texto-suave">
        Control de pesos en recepción pesca crustáceos.
        {meta && !editando && <> Guardada como borrador: <strong>{meta.id}</strong>.</>}
        {editando && <> Estado actual: <strong>{inicial?.estado === 'cerrado' ? 'cerrada' : 'borrador'}</strong>.</>}
      </p>
      <NavSecciones errores={erroresPorSeccion(errores)} />
      {mensaje && <Alerta tipo={mensaje.tipo}>{mensaje.texto}</Alerta>}
      {conflicto && onRecargar && (
        <div className="acciones-fila" data-testid="conflicto">
          <button type="button" className="boton-primario" onClick={onRecargar}>Volver a cargar la recepción</button>
          <p className="ayuda">Se descartan tus cambios sin guardar y se muestra la versión más reciente.</p>
        </div>
      )}
      {errores.general && <Alerta tipo="aviso">{errores.general}</Alerta>}

      <section className="tarjeta tarjeta-ancha" id="seccion-datos" aria-labelledby="sec1">
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
          <div className="campo" data-testid="grupo-llegada">
            <p className="etiqueta-falsa" id="llegada_en-etiqueta">El producto llegó en</p>
            <Conmutador idBase="llegada" ariaLabel="El producto llegó en bines o en gavetas" valor={f.llegada_en}
                        opciones={[{ valor: 'bines', texto: 'Bines' }, { valor: 'gavetas', texto: 'Gavetas' }]}
                        onChange={(v) => cambiar('llegada_en', v)} />
          </div>
          <div>
            <CampoTexto id="num_gavetas_bines" etiqueta="N.º de gavetas o bines" obligatorio modo="numeric" value={f.num_gavetas_bines}
                        onChange={(v) => cambiar('num_gavetas_bines', v.replace(/\D/g, ''))} error={errores.num_gavetas_bines} maxLength={4} />
            {/^\d+$/.test(f.num_gavetas_bines) && Number(f.num_gavetas_bines) > 0 && (
              <p className="leyenda-cantidad" data-testid="leyenda-cantidad" aria-live="polite">{textoCantidad(Number(f.num_gavetas_bines), f.llegada_en)}</p>
            )}
          </div>
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

      <SeccionGavetas gavetas={f.gavetas} errores={errores} onCambiar={cambiarGaveta} />
      <SeccionTemperaturas lecturas={f.temperaturas} gavetas={f.gavetas} errores={errores} onCambiar={cambiarLecturas} />
      <SeccionAlmacenamiento filas={f.almacenamiento} errores={errores} onCambiar={cambiarAlmacenamiento} />

      <section className="tarjeta tarjeta-ancha" id="seccion-cierre" aria-labelledby="sec5">
        <h2 id="sec5">5. Cierre</h2>
        <div className="rejilla-form">
          <Campo id="observacion" etiqueta="Observación" error={errores.observacion}>
            <textarea id="observacion" rows={3} value={f.observacion} maxLength={2000}
                      aria-invalid={Boolean(errores.observacion)} aria-describedby={errores.observacion ? 'observacion-error' : undefined}
                      onChange={(e) => cambiar('observacion', e.target.value)} />
          </Campo>
          <div className="campo grupo-lote" data-testid="grupo-cerrar-lote">
            <p className="etiqueta-falsa" id="cerrar_lote-etiqueta">¿Llegan más camiones con este lote?</p>
            {infoLote?.cerrado === true ? (
              <p className="ayuda" data-testid="lote-ya-cerrado">El lote <strong>{f.lote_id.trim().toUpperCase()}</strong> ya está <strong>cerrado</strong>. Un administrador puede reabrirlo.</p>
            ) : (
              <>
                <Conmutador idBase="lote" ariaLabel="Estado del lote al guardar" valor={f.cerrar_lote ? 'cerrado' : 'abierto'}
                            opciones={[{ valor: 'abierto', texto: 'Lote abierto' }, { valor: 'cerrado', texto: 'Cerrar lote' }]}
                            onChange={(v) => cambiar('cerrar_lote', v === 'cerrado')} />
                <p className="ayuda">Un lote cerrado ya no admite recepciones nuevas (un administrador puede reabrirlo). Un borrador nunca cierra el lote.</p>
              </>
            )}
          </div>
          <Campo id="realizado_por" etiqueta="Realizado por">
            <input id="realizado_por" type="text" readOnly value={(editando ? inicial?.realizado_por_nombre?.trim() : perfil?.nombre?.trim()) || perfil?.correo || ''} />
          </Campo>
        </div>
      </section>

      <div className="barra-acciones">
        <Link className="boton-secundario enlace-boton" to={editando ? `/m01/${inicial?.recepcion_id}` : '/m01'}>{editando ? 'Cancelar' : 'Salir'}</Link>
        {inicial?.estado !== 'cerrado' && (
          <button type="button" className="boton-secundario" disabled={guardando} onClick={() => void guardar('borrador')}>
            {guardando ? 'Guardando…' : 'Guardar borrador'}
          </button>
        )}
        <button type="button" className="boton-primario" disabled={guardando} onClick={() => void guardar('cerrado')}>
          {inicial?.estado === 'cerrado' ? (guardando ? 'Guardando…' : 'Guardar cambios') : 'Guardar y cerrar'}
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
