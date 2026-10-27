import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../core/auth/AuthContext';
import { Icono } from '../../../core/iconos';
import { Alerta, Cargando, Vacio } from '../../../core/ui';
import { mensajeDe } from '../../../lib/errores';
import { hoyEcuador } from '../../../lib/fechas';
import { useOnline } from '../../../lib/conexion';
import { useUnidad } from '../../../lib/unidades';
import { obtenerEspecieProveedor, obtenerPeriodos, obtenerProveedores } from './api';
import { descargarCsv, descargarPdf, descargarXlsx } from './descargas';
import GraficoBarras from './GraficoBarras';
import {
  ATAJOS, FUENTE, PERIODOS, VISTAS, construirTablas, datosGrafico, esFechaIso, esPeriodo, esVista, rangoAtajo, textoCelda, textoEstados, textoRango, unidadTexto, validarFiltros,
  type Atajo, type DatosReporte, type Filtros, type Periodo, type RespEspecie, type RespPeriodos, type RespProveedores, type Vista,
} from './reportes';

const num = (n: number) => new Intl.NumberFormat('en-US').format(n);

export default function PaginaReportes() {
  const { perfil } = useAuth();
  const { unidad, texto } = useUnidad();
  const online = useOnline();
  const [params, setParams] = useSearchParams();
  const hoy = hoyEcuador();
  const inicial = rangoAtajo('mes', hoy);

  const vistaP = params.get('vista');
  const vista: Vista = esVista(vistaP) ? vistaP : 'libras';
  const periodoP = params.get('periodo');
  const periodo: Periodo = esPeriodo(periodoP) ? periodoP : 'semana';
  const dP = params.get('desde'); const hP = params.get('hasta');
  const filtros: Filtros = {
    desde: dP && esFechaIso(dP) ? dP : inicial.desde,
    hasta: hP && esFechaIso(hP) ? hP : inicial.hasta,
    periodo, borradores: params.get('borradores') === '1',
  };

  const cambiar = (c: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    Object.entries(c).forEach(([k, v]) => (v === null || v === '' ? p.delete(k) : p.set(k, v)));
    setParams(p, { replace: true });
  };

  const error = validarFiltros(filtros, vista);
  const fuente = FUENTE[vista];
  const [datos, setDatos] = useState<{ clave: string; d: DatosReporte } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(null);
  const [preparando, setPreparando] = useState<string | null>(null);
  const pedido = useRef(0);

  const clave = `${fuente}|${filtros.desde}|${filtros.hasta}|${fuente === 'periodos' ? filtros.periodo : ''}|${filtros.borradores}`;

  const cargar = useCallback(async () => {
    if (error) return;
    const n = ++pedido.current;
    setCargando(true); setFallo(null);
    try {
      const d = fuente === 'periodos' ? await obtenerPeriodos(filtros) : fuente === 'proveedores' ? await obtenerProveedores(filtros) : await obtenerEspecieProveedor(filtros);
      if (n === pedido.current) setDatos({ clave, d });
    } catch (e) {
      if (n === pedido.current) setFallo(mensajeDe(e));
    } finally {
      if (n === pedido.current) setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, error]);

  useEffect(() => { if (online) void cargar(); else if (!datos || datos.clave !== clave) setFallo(null); }, [cargar, online]); // eslint-disable-line react-hooks/exhaustive-deps

  const vigente = datos && datos.clave === clave ? datos.d : null;
  const tablas = useMemo(() => (vigente ? construirTablas(vista, vigente, periodo, unidad) : []), [vigente, vista, periodo, unidad]);
  const grafico = useMemo(() => (vigente ? datosGrafico(vista, vigente, periodo, unidad) : null), [vigente, vista, periodo, unidad]);
  const vacio = vigente ? esVacio(vista, vigente) : false;

  const cab = {
    titulo: `Reporte: ${VISTAS.find((v) => v.id === vista)?.titulo}${fuente === 'periodos' ? ` (por ${PERIODOS.find((p) => p.id === periodo)?.singular})` : ''}`,
    rango: textoRango(filtros), estados: textoEstados(filtros.borradores), unidad: unidadTexto(unidad),
    generado: new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }),
  };
  const contexto = () => ({ vista, filtros, tablas, cab: { ...cab, generado: new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }) }, unidad, generadoPor: perfil?.nombre });

  const bajar = async (tipo: 'csv' | 'xlsx' | 'pdf') => {
    if (!vigente) return;
    setPreparando(tipo); setAviso(null);
    try {
      const nombre = tipo === 'csv' ? descargarCsv(contexto()) : tipo === 'xlsx' ? descargarXlsx(contexto()) : await descargarPdf(contexto());
      setAviso({ tipo: 'exito', texto: `Archivo descargado: ${nombre} (pesos en ${unidad === 'kg' ? 'kilogramos' : 'libras'}, igual que en la pantalla).` });
    } catch (e) {
      setAviso({ tipo: 'error', texto: `No se pudo generar el archivo. ${mensajeDe(e)}` });
    } finally { setPreparando(null); }
  };

  const teclasTabs = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = VISTAS.findIndex((v) => v.id === vista);
    let j = i;
    if (e.key === 'ArrowRight') j = (i + 1) % VISTAS.length;
    else if (e.key === 'ArrowLeft') j = (i + VISTAS.length - 1) % VISTAS.length;
    else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = VISTAS.length - 1; else return;
    e.preventDefault(); cambiar({ vista: VISTAS[j].id });
    requestAnimationFrame(() => document.getElementById(`tab-${VISTAS[j].id}`)?.focus());
  };

  return (
    <>
      <div className="encabezado-lista">
        <h1><Icono nombre="lista" tamano={28} />Reportes</h1>
        <div className="acciones-fila acciones-detalle"><Link className="boton-secundario enlace-boton" to="/m01"><Icono nombre="atras" />Volver a recepciones</Link></div>
      </div>

      <form className="filtros-lista filtros-reportes" onSubmit={(e) => e.preventDefault()} aria-label="Filtros del reporte">
        <div className="campo"><label htmlFor="rep-desde">Desde</label><input id="rep-desde" type="date" value={filtros.desde} max="2100-01-01" onChange={(e) => cambiar({ desde: e.target.value })} aria-invalid={!!error} /></div>
        <div className="campo"><label htmlFor="rep-hasta">Hasta</label><input id="rep-hasta" type="date" value={filtros.hasta} max="2100-01-01" onChange={(e) => cambiar({ hasta: e.target.value })} aria-invalid={!!error} /></div>
        {fuente === 'periodos' && (
          <div className="campo"><span className="etiqueta-grupo" id="rep-per-t">Agrupar por</span>
            <div className="interruptor" role="group" aria-labelledby="rep-per-t">
              {PERIODOS.map((p) => <button key={p.id} type="button" className={p.id === periodo ? 'activo' : ''} aria-pressed={p.id === periodo} onClick={() => cambiar({ periodo: p.id })}>{p.texto}</button>)}
            </div>
          </div>
        )}
        <div className="campo campo-check"><label><input type="checkbox" checked={filtros.borradores} onChange={(e) => cambiar({ borradores: e.target.checked ? '1' : null })} /> Incluir borradores</label></div>
        <div className="atajos" role="group" aria-label="Rangos rápidos">
          {ATAJOS.map((a: { id: Atajo; texto: string }) => <button key={a.id} type="button" className="boton-secundario boton-chico" onClick={() => { const r = rangoAtajo(a.id, hoy); cambiar({ desde: r.desde, hasta: r.hasta }); }}>{a.texto}</button>)}
        </div>
      </form>

      <div className="tabs" role="tablist" aria-label="Reportes" onKeyDown={teclasTabs}>
        {VISTAS.map((v) => (
          <button key={v.id} id={`tab-${v.id}`} role="tab" type="button" aria-selected={v.id === vista} aria-controls="panel-rep" tabIndex={v.id === vista ? 0 : -1}
                  className={v.id === vista ? 'activo' : ''} onClick={() => cambiar({ vista: v.id })}>{v.corto}</button>
        ))}
      </div>

      <section id="panel-rep" role="tabpanel" aria-labelledby={`tab-${vista}`} className="panel-reporte" aria-busy={cargando}>
        <p className="nota-reporte" data-testid="nota-estados">{textoRango(filtros)} · {textoEstados(filtros.borradores)} · Pesos en <strong>{unidad === 'kg' ? 'kilogramos (kg)' : 'libras (lb)'}</strong> (cambia con el interruptor Lb / Kg de arriba).</p>
        {error && <Alerta tipo="error">{error}</Alerta>}
        {!error && !online && !vigente && <Alerta tipo="aviso">Necesitas conexión para ver los reportes.</Alerta>}
        {!error && !online && vigente && <Alerta tipo="aviso">Sin conexión: se muestran los últimos datos cargados.</Alerta>}
        {!error && fallo && <Alerta tipo="error">{fallo} <button type="button" className="boton-secundario boton-chico" onClick={() => void cargar()}>Reintentar</button></Alerta>}
        {!error && cargando && !vigente && <Cargando texto="Calculando el reporte…" />}
        {!error && vigente && vacio && <Vacio titulo="Sin datos en este rango"><p>No hay recepciones cerradas entre esas fechas. Prueba otro rango o marca «Incluir borradores».</p></Vacio>}
        {!error && vigente && !vacio && (
          <>
            <Tarjetas vista={vista} datos={vigente} texto={texto} />
            {grafico && <GraficoBarras datos={grafico} />}
            {tablas.map((t) => (
              <div className="tabla-scroll" key={t.id} tabIndex={0} role="region" aria-label={t.titulo}>
                <table className="tabla-reporte" data-testid={`tabla-${t.id}`}>
                  <caption>{t.titulo}</caption>
                  <thead><tr>{t.columnas.map((c) => <th key={c.titulo} scope="col" className={c.tipo === 'texto' ? '' : 'der'}>{c.titulo}</th>)}</tr></thead>
                  <tbody>{t.filas.map((f, i) => <tr key={i}>{f.map((c, j) => j === 0 ? <th key={j} scope="row">{textoCelda(c, t.columnas[j].tipo, unidad)}</th> : <td key={j} className={t.columnas[j].tipo === 'texto' ? '' : 'der'}>{textoCelda(c, t.columnas[j].tipo, unidad)}</td>)}</tr>)}</tbody>
                  {t.totales && <tfoot><tr>{t.totales.map((c, j) => j === 0 ? <th key={j} scope="row">{textoCelda(c, t.columnas[j].tipo, unidad)}</th> : <td key={j} className={t.columnas[j].tipo === 'texto' ? '' : 'der'}>{textoCelda(c, t.columnas[j].tipo, unidad)}</td>)}</tr></tfoot>}
                </table>
                {t.nota && <p className="grafico-nota">{t.nota}</p>}
              </div>
            ))}
          </>
        )}
      </section>

      {aviso && <Alerta tipo={aviso.tipo}>{aviso.texto}</Alerta>}
      <div className="descargas-reporte" role="group" aria-label="Descargar este reporte">
        <span className="etiqueta-grupo">Descargar este reporte:</span>
        {(['csv', 'xlsx', 'pdf'] as const).map((t) => (
          <button key={t} type="button" className="boton-secundario" data-testid={`bajar-${t}`} disabled={!vigente || vacio || !!error || preparando !== null} onClick={() => void bajar(t)}>
            <Icono nombre={t === 'pdf' ? 'pdf' : 'excel'} />{preparando === t ? 'Preparando…' : t === 'csv' ? 'CSV' : t === 'xlsx' ? 'Excel (.xlsx)' : 'PDF'}
          </button>
        ))}
        <span className="grafico-nota">Los archivos llevan las tablas y totales (sin gráficos), en la unidad elegida.</span>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">{cargando ? 'Calculando el reporte' : vigente ? 'Reporte actualizado' : ''}</p>
    </>
  );
}

function esVacio(vista: Vista, d: DatosReporte): boolean {
  if (FUENTE[vista] === 'periodos') return (d as RespPeriodos).totales.recepciones === 0;
  if (FUENTE[vista] === 'proveedores') return (d as RespProveedores).totales.recepciones === 0;
  return (d as RespEspecie).totales.recepciones === 0;
}

function Tarjetas({ vista, datos, texto }: { vista: Vista; datos: DatosReporte; texto: (lb: number) => string }) {
  let items: [string, string][] = [];
  if (FUENTE[vista] === 'periodos') {
    const t = (datos as RespPeriodos).totales;
    items = vista === 'libras'
      ? [['Libras planta', texto(t.libras_planta)], ['Libras reportadas', texto(t.libras_reportadas)], ['Diferencia', texto(t.diferencia_lb)], ['Recepciones', num(t.recepciones)]]
      : [['Lotes', num(t.lotes)], ['Recepciones', num(t.recepciones)]];
  } else if (FUENTE[vista] === 'proveedores') {
    const d = datos as RespProveedores;
    items = vista === 'proveedores'
      ? [['Proveedores con recepción', num(d.proveedores_con_recepcion)], ['Recepciones', num(d.totales.recepciones)], ['Lotes', num(d.totales.lotes)]]
      : [['Libras planta', texto(d.totales.libras_planta)], ['Proveedores', num(d.proveedores_con_recepcion)], ['Recepciones', num(d.totales.recepciones)]];
  } else {
    const t = (datos as RespEspecie).totales;
    items = [['Libras planta', texto(t.libras_planta)], ['Especies', num(t.especies)], ['Proveedores', num(t.proveedores)], ['Lotes', num(t.lotes)]];
  }
  return <dl className="tarjetas-reporte" data-testid="tarjetas">{items.map(([k, v]) => <div key={k} className="tarjeta-reporte"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
