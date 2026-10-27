import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useBlocker, useNavigate } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthContext';
import { Alerta, Modal } from '../../core/ui';
import { PesoInput, useUnidad } from '../../lib/unidades';
import { totalPesos } from './calculos';
import { aApiError, mensajeDe } from '../../lib/errores';
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
import FotosEditor from './FotosEditor';
import { subirFoto } from './fotos';
import { cola, protegerAlmacenamiento } from '../../offline/pendientes';
import type { FotoPendiente, Pendiente } from '../../offline/db';
import { useOnline } from '../../lib/conexion';
import { recepcionAForm } from './mapeo';
import { aPayload, erroresPorSeccion, validarRecepcion } from './esquema';
import { FORMATO_LOTE_POR_DEFECTO, filaAlmacenamientoVacia, gavetasVacias, lecturasVacias, type CampoForm, type AlmacenamientoForm, type LecturaForm, type Errores, type FormRecepcion, type FotoNueva, type InfoLote, type RecepcionDetalle, type RespuestaGuardar } from './tipos';
import { Icono } from '../../core/iconos';

const ORDEN_CAMPOS: CampoForm[] = [
  'fecha_llegada', 'placa_vehiculo', 'lote_id', 'proveedor', 'especie', 'piscina', 'guia_remision', 'num_gavetas_bines',
  'libras_reportadas', 'libras_planta', 'hora_inicio_descarga', 'hora_fin_descarga', 'observacion',
];

const vacio = (): FormRecepcion => ({
  fecha_llegada: hoyEcuador(), placa_vehiculo: '', lote_id: '', proveedor: '', especie: '', piscina: '', guia_remision: '',
  llegada_en: 'bines', num_gavetas_bines: '', libras_reportadas: null, libras_planta: null, hora_inicio_descarga: '', hora_fin_descarga: '',
  observacion: '', cerrar_lote: true, gavetas: gavetasVacias(), temperaturas: lecturasVacias(), almacenamiento: [filaAlmacenamientoVacia()],
});

type Mensaje = { tipo: 'exito' | 'error' | 'aviso'; texto: string } | null;

interface Props {
  /** Si se indica, el formulario edita esa recepción (borrador o cerrada) en lugar de crear una nueva. */
  inicial?: RecepcionDetalle;
  /** Vuelve a pedir la recepción a la base de datos (cuando otra persona la modificó). */
  onRecargar?: () => void;
  /** Si se indica, se corrige una recepción guardada en este dispositivo que el servidor rechazó. */
  pendiente?: Pendiente;
  /** Se llama al guardar una recepción NUEVA: quien lo usa vacía el formulario y muestra el aviso. */
  onGuardadoNuevo?: (aviso: AvisoGuardado) => void;
}

/** Mensaje que se muestra sobre el formulario ya vacío después de guardar. */
export interface AvisoGuardado { tipo: 'exito' | 'aviso'; texto: ReactNode; segundos: number }

/**
 * Formulario de recepción completo: datos generales, gavetas, temperaturas, almacenamiento y cierre.
 * Al guardar una recepción nueva (borrador o cerrada) el formulario se vuelve a crear desde cero: no queda ningún dato anterior.
 */
export default function FormularioRecepcion(props: Omit<Props, 'onGuardadoNuevo'> = {}) {
  const [instancia, setInstancia] = useState(0);
  const [aviso, setAviso] = useState<AvisoGuardado | null>(null);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.segundos * 1000);
    return () => clearTimeout(t);
  }, [aviso]);
  return (
    <>
      {aviso && (
        <Alerta tipo={aviso.tipo}>
          {aviso.texto} <button type="button" className="boton-enlace" onClick={() => setAviso(null)}>Cerrar aviso</button>
        </Alerta>
      )}
      <FormularioInterno key={instancia} {...props}
                         onGuardadoNuevo={(a) => { setAviso(a); setInstancia((n) => n + 1); window.scrollTo({ top: 0 }); }} />
    </>
  );
}

function FormularioInterno({ inicial, onRecargar, pendiente }: Props) {
  const { perfil, puede } = useAuth();
  const navigate = useNavigate();
  const editando = Boolean(inicial);
  const corrigiendo = Boolean(pendiente);
  const online = useOnline();
  const [f, setF] = useState<FormRecepcion>(() => (inicial ? recepcionAForm(inicial) : pendiente ? pendiente.form : vacio()));
  const [errores, setErrores] = useState<Errores>({});
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [guardando, setGuardando] = useState(false);
  const [sucio, setSucio] = useState(corrigiendo);
  const [meta, setMeta] = useState<{ id: string; version: number } | null>(inicial ? { id: inicial.recepcion_id, version: inicial.version } : null);
  const [conflicto, setConflicto] = useState(false);
  /** Lote en el que ya está guardada la recepción: ahí sigue permitido aunque el lote se haya cerrado. */
  const loteGuardado = useRef<string | null>(inicial ? inicial.lote_id : null);
  const salidaLibre = useRef(false);
  const [infoLote, setInfoLote] = useState<InfoLote | null>(null);
  const [formatoLote, setFormatoLote] = useState(FORMATO_LOTE_POR_DEFECTO);
  const [fotosNuevas, setFotosNuevas] = useState<FotoNueva[]>(() => (pendiente?.fotos ?? []).map((x) => ({
    id: x.id, nombre: x.nombre, tipo: x.tipo, blob: x.blob, tamano: x.tamano, previewUrl: URL.createObjectURL(x.blob), estado: 'lista' as const,
  })));
  const { texto: textoPeso } = useUnidad();
  const [avisoLoteAbierto, setAvisoLoteAbierto] = useState(false);
  useEffect(() => {
    if (!avisoLoteAbierto) return;
    const t = setTimeout(() => setAvisoLoteAbierto(false), 5000);
    return () => clearTimeout(t);
  }, [avisoLoteAbierto]);
  const fotosRef = useRef<FotoNueva[]>([]);
  fotosRef.current = fotosNuevas;
  const [refrescoFotos, setRefrescoFotos] = useState(0);
  const [maxFotos, setMaxFotos] = useState(5);
  /** La recepción ya se guardó pero alguna foto no se pudo subir: se ofrece reintentar o terminar sin ellas. */
  const [pendienteFin, setPendienteFin] = useState<{ r: RespuestaGuardar; estado: 'borrador' | 'cerrado' } | null>(null);
  const clientUuid = useRef<string>(pendiente?.client_uuid ?? crypto.randomUUID());
  const proveedorHeredado = useRef(false);

  // Formato del lote desde la configuración de la base de datos (si no hay red, se usa el de fábrica).
  useEffect(() => {
    let vivo = true;
    obtenerConfig().then((c) => { if (!vivo) return; if (c.formato_lote) setFormatoLote(c.formato_lote); if (c.max_fotos_recepcion) setMaxFotos(c.max_fotos_recepcion); }).catch(() => { /* se usa el de fábrica */ });
    return () => { vivo = false; };
  }, []);

  // Aviso al salir con cambios sin guardar (cierre de pestaña y navegación interna).
  const sinGuardar = sucio || fotosNuevas.length > 0;
  useEffect(() => {
    if (!sinGuardar) return;
    const antes = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', antes);
    return () => window.removeEventListener('beforeunload', antes);
  }, [sinGuardar]);
  useEffect(() => () => { fotosRef.current.forEach((x) => { if (x.previewUrl) URL.revokeObjectURL(x.previewUrl); }); }, []);
  const bloqueo = useBlocker(({ currentLocation, nextLocation }) => sinGuardar && !salidaLibre.current && currentLocation.pathname !== nextLocation.pathname);

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

  /** Sube las fotos que esperan (las nuevas y las que fallaron antes). Devuelve cuántas no se pudieron subir. */
  const subirPendientes = async (recepcionId: string): Promise<number> => {
    const ids = fotosRef.current.filter((x) => x.estado === 'lista' || x.estado === 'error').map((x) => x.id);
    let fallidas = 0;
    for (const id of ids) {
      const foto = fotosRef.current.find((x) => x.id === id);
      if (!foto?.blob) continue;
      setFotosNuevas((p) => p.map((x) => (x.id === id ? { ...x, estado: 'subiendo', error: undefined } : x)));
      try {
        await subirFoto(recepcionId, { blob: foto.blob, nombre: foto.nombre, tipo: foto.tipo });
        if (foto.previewUrl) URL.revokeObjectURL(foto.previewUrl);
        setFotosNuevas((p) => p.filter((x) => x.id !== id));
      } catch (e) {
        fallidas++;
        setFotosNuevas((p) => p.map((x) => (x.id === id ? { ...x, estado: 'error', error: mensajeDe(e) } : x)));
      }
    }
    setRefrescoFotos((n) => n + 1);
    return fallidas;
  };

  /** Lo que sigue cuando la recepción y sus fotos quedaron resueltas. */
  const continuar = (r: RespuestaGuardar, estado: 'borrador' | 'cerrado') => {
    setPendienteFin(null);
    setSucio(false);
    // Después de guardar siempre se vuelve al listado, para comprobar que la recepción quedó registrada.
    salidaLibre.current = true;
    const lote = f.lote_id.trim().toUpperCase();
    const aviso = estado === 'cerrado'
      ? `La recepción ${r.recepcion_id} se guardó y quedó cerrada. ${r.lote_cerrado ? `El lote ${lote} quedó cerrado.` : `El lote ${lote} sigue abierto: puede llegar otro camión.`}`
      : `Borrador ${r.recepcion_id} guardado. Para completarlo, ábrelo y presiona Editar.`;
    navigate('/m01', { state: { aviso } });
  };

  const reintentarFotos = async () => {
    if (!pendienteFin) return;
    setGuardando(true); setMensaje(null);
    const fallidas = await subirPendientes(pendienteFin.r.recepcion_id);
    setGuardando(false);
    if (fallidas === 0) continuar(pendienteFin.r, pendienteFin.estado);
    else setMensaje({ tipo: 'error', texto: `Todavía hay ${fallidas} foto${fallidas === 1 ? '' : 's'} sin subir. Revisa tu conexión e intenta de nuevo.` });
  };

  const terminarSinFotos = () => {
    fotosRef.current.forEach((x) => { if (x.previewUrl) URL.revokeObjectURL(x.previewUrl); });
    setFotosNuevas([]);
    if (pendienteFin) continuar(pendienteFin.r, pendienteFin.estado);
  };

  /** Guarda la recepción en este dispositivo para enviarla cuando haya conexión (solo para recepciones que aún no están en el servidor). */
  const encolar = async (estado: 'borrador' | 'cerrado', loteExiste: boolean | null): Promise<boolean> => {
    const uid = perfil?.user_id;
    if (!uid) { setMensaje({ tipo: 'error', texto: 'Tu sesión no es válida. Vuelve a iniciar sesión.' }); return false; }
    const fotos: FotoPendiente[] = fotosRef.current.filter((x) => x.blob).map((x) => ({ id: x.id, nombre: x.nombre, tipo: x.tipo, blob: x.blob!, tamano: x.tamano }));
    const payload = aPayload(f, { client_uuid: clientUuid.current, estado, loteExiste });
    const resumen = { lote_id: f.lote_id.trim().toUpperCase(), guia_remision: f.guia_remision.trim(), proveedor: f.proveedor.trim(), especie: f.especie.trim(), fecha_llegada: f.fecha_llegada, estado };
    try {
      if (pendiente) await cola.corregir(pendiente.client_uuid, { payload, form: f, fotos, resumen });
      else await cola.encolar({ client_uuid: clientUuid.current, user_id: uid, payload, form: f, fotos, resumen });
    } catch (e) {
      setMensaje({ tipo: 'error', texto: `No se pudo guardar en este dispositivo (${(e as Error).message || 'sin espacio o sin permiso'}). Tus datos siguen en la pantalla.` });
      return false;
    }
    void protegerAlmacenamiento();
    fotosRef.current.forEach((x) => { if (x.previewUrl) URL.revokeObjectURL(x.previewUrl); });
    setFotosNuevas([]);
    setSucio(false);
    if (navigator.onLine) void cola.sincronizar(uid);
    salidaLibre.current = true;
    if (pendiente) navigate('/m01/pendientes', { state: { aviso: 'Corregida. Se enviará en cuanto haya conexión.' } });
    else navigate('/m01', { state: { aviso: `La recepción con guía ${resumen.guia_remision} (lote ${resumen.lote_id}) se guardó en este dispositivo y todavía no está en el servidor. Se enviará sola en cuanto haya conexión${fotos.length > 0 ? `, junto con ${fotos.length} foto${fotos.length === 1 ? '' : 's'}` : ''}. No borres los datos del navegador hasta que se envíe.` } });
    return true;
  };

  const guardar = async (estado: 'borrador' | 'cerrado') => {
    if (fotosRef.current.some((x) => x.estado === 'comprimiendo')) {
      setMensaje({ tipo: 'aviso', texto: 'Espera un momento: las fotos se están preparando.' });
      return;
    }
    const loteExiste = infoLote ? infoLote.existe : null;
    const errs = validarRecepcion(f, { formatoLote, hoy: hoyEcuador(), cerrando: estado === 'cerrado', loteExiste, loteCerrado: infoLote?.cerrado === true && loteGuardado.current !== f.lote_id.trim().toUpperCase(), pesoTexto: textoPeso });
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
    // Recepción nueva que todavía no está en el servidor: sin señal (o corrigiendo un pendiente) se guarda en este dispositivo.
    const puedeEncolar = !editando && !meta;
    if (puedeEncolar && (corrigiendo || !navigator.onLine)) {
      await encolar(estado, loteExiste);
      setGuardando(false);
      return;
    }
    try {
      const r = await guardarRecepcion(aPayload(f, {
        client_uuid: clientUuid.current, estado, loteExiste,
        recepcion_id: meta?.id, version: meta?.version,
      }));
      setMeta({ id: r.recepcion_id, version: r.version });
      loteGuardado.current = f.lote_id.trim().toUpperCase();
      setSucio(false);
      if (fotosRef.current.some((x) => x.estado === 'lista' || x.estado === 'error')) {
        const fallidas = await subirPendientes(r.recepcion_id);
        if (fallidas > 0) {
          // La recepción NO se pierde: ya está guardada. Solo quedan fotos por resolver.
          setPendienteFin({ r, estado });
          setMensaje({ tipo: 'error', texto: `La recepción ${r.recepcion_id} quedó guardada, pero ${fallidas} foto${fallidas === 1 ? '' : 's'} no se pudo subir. Reintenta o termina sin ${fallidas === 1 ? 'ella' : 'ellas'}.` });
          return;
        }
      }
      continuar(r, estado);
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
        if (puedeEncolar) {
          // Pudo haber llegado al servidor sin que lo supiéramos: reenviar con el mismo client_uuid no lo duplica.
          await encolar(estado, loteExiste);
        } else {
          setMensaje({ tipo: 'error', texto: 'Sin conexión: para modificar una recepción que ya está guardada necesitas señal. Tus datos siguen en la pantalla; intenta de nuevo cuando tengas señal.' });
        }
      } else {
        setMensaje({ tipo: 'error', texto: err.message });
      }
    } finally {
      setGuardando(false);
    }
  };

  const heredado = infoLote?.existe === true;
  /** Aviso inmediato: las libras no pueden ser menores que el peso total de las gavetas ya escritas. */
  const totalGavetas = totalPesos(f.gavetas);
  const avisoLibras = (lb: number | null) =>
    lb !== null && lb > 0 && lb < totalGavetas ? `No puede ser menor que el peso total de las gavetas (${textoPeso(totalGavetas)}).` : undefined;
  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate aria-label="Formulario de recepción">
      <h1>{editando ? `Editar recepción ${inicial?.recepcion_id}` : corrigiendo ? 'Corregir recepción pendiente' : 'Nueva recepción'}</h1>
      {pendiente?.ultimo_error && <Alerta tipo="error">El servidor no aceptó esta recepción: {pendiente.ultimo_error} Corrígela y vuelve a guardar.</Alerta>}
      {!online && !editando && !meta && <Alerta tipo="aviso">Estás sin conexión: al guardar, la recepción quedará en este dispositivo y se enviará sola cuando vuelva la señal.</Alerta>}
      {!online && (editando || meta) && <Alerta tipo="aviso">Estás sin conexión: para guardar cambios de una recepción que ya está en el servidor necesitas señal.</Alerta>}
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
        <h2 id="sec1" className="titulo-seccion"><Icono nombre="nota" />1. Datos generales</h2>
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
            <div className="fila-compacta">
              <Conmutador compacto idBase="llegada" ariaLabel="El producto llegó en bines o en gavetas" valor={f.llegada_en}
                          opciones={[{ valor: 'bines', texto: 'Bines' }, { valor: 'gavetas', texto: 'Gavetas' }]}
                          onChange={(v) => cambiar('llegada_en', v)} />
              {/^\d+$/.test(f.num_gavetas_bines) && Number(f.num_gavetas_bines) > 0 && (
                <p className="leyenda-cantidad" data-testid="leyenda-cantidad" aria-live="polite">{textoCantidad(Number(f.num_gavetas_bines), f.llegada_en)}</p>
              )}
            </div>
          </div>
          <CampoTexto id="num_gavetas_bines" etiqueta="N.º de gavetas o bines" obligatorio modo="numeric" value={f.num_gavetas_bines}
                      onChange={(v) => cambiar('num_gavetas_bines', v.replace(/\D/g, ''))} error={errores.num_gavetas_bines} maxLength={4} />
          <PesoInput id="libras_reportadas" etiqueta="Libras reportadas" value={f.libras_reportadas}
                     onChange={(v) => cambiar('libras_reportadas', v)} error={errores.libras_reportadas ?? avisoLibras(f.libras_reportadas)} />
          <PesoInput id="libras_planta" etiqueta="Libras de planta" value={f.libras_planta}
                     onChange={(v) => cambiar('libras_planta', v)} error={errores.libras_planta ?? avisoLibras(f.libras_planta)} />
          <CampoTexto id="hora_inicio_descarga" etiqueta="Hora de inicio de descarga" tipo="time" value={f.hora_inicio_descarga}
                      onChange={(v) => cambiar('hora_inicio_descarga', v)} error={errores.hora_inicio_descarga} />
          <CampoTexto id="hora_fin_descarga" etiqueta="Hora de fin de descarga" tipo="time" value={f.hora_fin_descarga}
                      onChange={(v) => cambiar('hora_fin_descarga', v)} error={errores.hora_fin_descarga} />
        </div>
      </section>

      <PanelCalculos f={f} />

      <SeccionGavetas gavetas={f.gavetas} errores={errores} onCambiar={cambiarGaveta} />
      <SeccionTemperaturas lecturas={f.temperaturas} gavetas={f.gavetas} errores={errores} onCambiar={cambiarLecturas} />
      <SeccionAlmacenamiento filas={f.almacenamiento} errores={errores} onCambiar={cambiarAlmacenamiento}
        datosQr={{ lote: f.lote_id.trim().toUpperCase(), fecha: f.fecha_llegada, guia: f.guia_remision, librasPlanta: f.libras_planta === null || f.libras_planta === undefined ? null : Number(f.libras_planta), proveedor: f.proveedor, especie: f.especie }} />

      <section className="tarjeta tarjeta-ancha" id="seccion-cierre" aria-labelledby="sec5">
        <h2 id="sec5" className="titulo-seccion"><Icono nombre="ok" />5. Cierre</h2>
        <div className="rejilla-form">
          <Campo id="observacion" etiqueta="Observación" error={errores.observacion}>
            <textarea id="observacion" rows={3} value={f.observacion} maxLength={2000}
                      aria-invalid={Boolean(errores.observacion)} aria-describedby={errores.observacion ? 'observacion-error' : undefined}
                      onChange={(e) => cambiar('observacion', e.target.value)} />
          </Campo>
          <div className="campo grupo-lote" data-testid="grupo-cerrar-lote">
            {infoLote?.cerrado === true ? (
              <>
                <p className="etiqueta-falsa" id="cerrar_lote-etiqueta">¿Llegan más camiones con este lote?</p>
                <p className="ayuda" data-testid="lote-ya-cerrado">El lote <strong>{f.lote_id.trim().toUpperCase()}</strong> ya está <strong>cerrado</strong>. Un administrador puede reabrirlo.</p>
              </>
            ) : (
              <>
                <div className="fila-lote">
                  <p className="etiqueta-falsa" id="cerrar_lote-etiqueta">¿Llegan más camiones con este lote?</p>
                  <Conmutador compacto idBase="lote" ariaLabel="Estado del lote al guardar" valor={f.cerrar_lote ? 'cerrado' : 'abierto'}
                              opciones={[{ valor: 'abierto', texto: 'Lote abierto' }, { valor: 'cerrado', texto: 'Cerrar lote' }]}
                              onChange={(v) => { cambiar('cerrar_lote', v === 'cerrado'); setAvisoLoteAbierto(v === 'abierto'); }} />
                </div>
                {avisoLoteAbierto && !f.cerrar_lote && (
                  <p className="aviso-campo aviso-nuevo" role="status" data-testid="aviso-lote-abierto">Este lote quedará abierto: se va a completar en otra recepción (otro camión).</p>
                )}
                <p className="ayuda">Un lote cerrado ya no admite recepciones nuevas (un administrador puede reabrirlo). Un borrador nunca cierra el lote.</p>
              </>
            )}
          </div>
          <Campo id="realizado_por" etiqueta="Realizado por">
            <input id="realizado_por" type="text" readOnly value={(editando ? inicial?.realizado_por_nombre?.trim() : perfil?.nombre?.trim()) || perfil?.correo || ''} />
          </Campo>
          <div className="campo grupo-lote" id="seccion-fotos">
            <FotosEditor recepcionId={meta?.id} pendientes={fotosNuevas} setPendientes={setFotosNuevas} max={maxFotos}
                         refrescar={refrescoFotos} puedeAgregar={puede('M01', 'cargar_imagenes') && !pendienteFin} />
          </div>
        </div>
      </section>

      {pendienteFin ? (
        <div className="barra-acciones" data-testid="barra-fotos-fallidas">
          <button type="button" className="boton-secundario" disabled={guardando} onClick={terminarSinFotos}>Terminar sin esas fotos</button>
          <button type="button" className="boton-primario" disabled={guardando} onClick={() => void reintentarFotos()}>
            {guardando ? 'Subiendo…' : 'Reintentar subir las fotos'}
          </button>
        </div>
      ) : (
      <div className="barra-acciones">
        <Link className="boton-secundario enlace-boton" to={editando ? `/m01/${inicial?.recepcion_id}` : '/m01'}><Icono nombre="cerrar" tamano={18} />{editando ? 'Cancelar' : 'Salir'}</Link>
        {inicial?.estado !== 'cerrado' && (
          <button type="button" className="boton-secundario" disabled={guardando} onClick={() => void guardar('borrador')}>
            <Icono nombre="guardar" tamano={18} />{guardando ? 'Guardando…' : 'Guardar borrador'}
          </button>
        )}
        <button type="button" className="boton-primario" disabled={guardando} onClick={() => void guardar('cerrado')}>
          <Icono nombre="ok" tamano={18} />{inicial?.estado === 'cerrado' ? (guardando ? 'Guardando…' : 'Guardar cambios') : 'Guardar y cerrar'}
        </button>
      </div>
      )}

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
