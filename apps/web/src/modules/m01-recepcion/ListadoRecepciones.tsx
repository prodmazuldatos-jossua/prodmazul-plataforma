import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthContext';
import { Alerta, Cargando, Vacio } from '../../core/ui';
import { mensajeDe } from '../../lib/errores';
import { formatoFecha } from '../../lib/fechas';
import { textoCantidad } from '../../lib/texto';
import { useUnidad } from '../../lib/unidades';
import { listarRecepciones } from './api';
import InsigniaEstado from './InsigniaEstado';
import { paginacion } from './mapeo';
import type { FiltrosListado, RespuestaListado } from './tipos';
import { Icono } from '../../core/iconos';
import { useOnline } from '../../lib/conexion';
import { descargarExcelRecepciones } from './excelDescarga';

const POR_PAGINA = 20;
const ESTADOS_VALIDOS = ['activos', 'borrador', 'cerrado', 'anulado', 'todos', 'eliminado'];

export default function ListadoRecepciones() {
  const { puede } = useAuth();
  const { texto: peso } = useUnidad();
  const [params, setParams] = useSearchParams();
  const { state: estadoNav } = useLocation() as { state: { aviso?: string } | null };
  const avisoGuardado = estadoNav?.aviso ?? null;
  const estadoUrl = params.get('estado') ?? 'activos';
  const filtros: FiltrosListado = {
    busqueda: params.get('q') ?? '',
    estado: (ESTADOS_VALIDOS.includes(estadoUrl) ? estadoUrl : 'activos') as FiltrosListado['estado'],
    desde: params.get('desde') ?? '',
    hasta: params.get('hasta') ?? '',
    limite: POR_PAGINA,
    desplazamiento: Math.max(0, (Number(params.get('pag')) || 1) - 1) * POR_PAGINA,
  };
  const [texto, setTexto] = useState(filtros.busqueda);
  const [datos, setDatos] = useState<RespuestaListado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [intento, setIntento] = useState(0);
  const online = useOnline();
  const [exportando, setExportando] = useState(false);
  const [avisoExcel, setAvisoExcel] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(null);
  const exportar = async () => {
    setExportando(true); setAvisoExcel(null);
    try {
      const r = await descargarExcelRecepciones();
      setAvisoExcel({ tipo: 'exito', texto: `Excel descargado: ${r.nombre} (${r.recepciones} ${r.recepciones === 1 ? 'recepción' : 'recepciones'}, pesos en libras).` });
    } catch (e) {
      setAvisoExcel({ tipo: 'error', texto: `No se pudo generar el Excel. ${mensajeDe(e)}` });
    } finally { setExportando(false); }
  };

  const cambiar = (cambios: Record<string, string>, reiniciarPagina = true) => {
    const nuevo = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) { if (v) nuevo.set(k, v); else nuevo.delete(k); }
    if (reiniciarPagina) nuevo.delete('pag');
    setParams(nuevo, { replace: true });
  };

  // La búsqueda por texto espera un momento a que termines de escribir.
  useEffect(() => {
    if (texto === filtros.busqueda) return;
    const t = setTimeout(() => cambiar({ q: texto.trim() }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const clave = JSON.stringify(filtros);
  useEffect(() => {
    let vigente = true;
    setCargando(true); setError(null);
    listarRecepciones(JSON.parse(clave) as FiltrosListado)
      .then((r) => { if (vigente) setDatos(r); })
      .catch((e) => { if (vigente) { setError(mensajeDe(e)); setDatos(null); } })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [clave, intento]);

  const { pagina, paginas } = useMemo(() => paginacion(datos?.total ?? 0, filtros.desplazamiento, POR_PAGINA), [datos, filtros.desplazamiento]);
  const hayFiltros = filtros.busqueda !== '' || filtros.desde !== '' || filtros.hasta !== '' || filtros.estado !== 'activos';

  return (
    <>
      <div className="encabezado-lista">
        <h1><Icono nombre="recepcion" tamano={28} />Recepciones</h1>
        <div className="acciones-fila acciones-detalle">
          {puede('M01', 'ver_reportes') && <Link className="boton-secundario enlace-boton" to="/m01/reportes" data-testid="enlace-reportes"><Icono nombre="lista" />Reportes</Link>}
          {puede('M01', 'ver_reportes') && (
            <button type="button" className="boton-secundario" data-testid="boton-excel" disabled={exportando || !online} onClick={() => void exportar()}
                    title={online ? 'Descarga todas las recepciones con todas sus columnas' : 'Necesitas conexión para descargar el Excel'}>
              <Icono nombre="excel" />{exportando ? 'Preparando Excel…' : 'Descargar Excel'}
            </button>
          )}
          {puede('M01', 'crear') && <Link className="boton-primario enlace-boton" to="/m01/nueva"><Icono nombre="mas" />Nueva recepción</Link>}
        </div>
      </div>
      {avisoGuardado && <Alerta tipo="exito">{avisoGuardado}</Alerta>}
      {avisoExcel && <Alerta tipo={avisoExcel.tipo}>{avisoExcel.texto}</Alerta>}

      <form className="filtros-lista" onSubmit={(e) => e.preventDefault()} aria-label="Filtros del listado">
        <div className="campo campo-busqueda">
          <label htmlFor="f-busqueda">Buscar</label>
          <input id="f-busqueda" type="search" value={texto} placeholder="Número, guía, lote, placa, proveedor o especie"
                 onChange={(e) => setTexto(e.target.value)} autoComplete="off" />
        </div>
        <div className="campo">
          <label htmlFor="f-estado">Estado</label>
          <select id="f-estado" value={filtros.estado} onChange={(e) => cambiar({ estado: e.target.value === 'activos' ? '' : e.target.value })}>
            <option value="activos">Activas (borrador y cerradas)</option>
            <option value="borrador">Solo borradores</option>
            <option value="cerrado">Solo cerradas</option>
            <option value="anulado">Anuladas</option>
            <option value="todos">Todas</option>
            {puede('M01', 'eliminar') && <option value="eliminado">Eliminadas</option>}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="f-desde">Desde</label>
          <input id="f-desde" type="date" value={filtros.desde} max={filtros.hasta || undefined} onChange={(e) => cambiar({ desde: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="f-hasta">Hasta</label>
          <input id="f-hasta" type="date" value={filtros.hasta} min={filtros.desde || undefined} onChange={(e) => cambiar({ hasta: e.target.value })} />
        </div>
        {hayFiltros && (
          <button type="button" className="boton-secundario" onClick={() => { setTexto(''); setParams({}, { replace: true }); }}><Icono nombre="cerrar" tamano={18} />Quitar filtros</button>
        )}
      </form>

      {error && (
        <Alerta tipo="error">
          {error} <button type="button" className="boton-enlace" onClick={() => setIntento((n) => n + 1)}>Reintentar</button>
        </Alerta>
      )}
      {cargando && <Cargando texto="Cargando recepciones…" />}

      {!cargando && datos && datos.items.length === 0 && (
        <Vacio titulo={hayFiltros ? 'No hay recepciones con esos filtros' : 'Aún no hay recepciones'}>
          {!hayFiltros && puede('M01', 'crear') && <p>Registra la primera con «Nueva recepción».</p>}
        </Vacio>
      )}

      {!cargando && datos && datos.items.length > 0 && (
        <>
          <p className="texto-suave" data-testid="total-lista" aria-live="polite">
            {datos.total} {datos.total === 1 ? 'recepción' : 'recepciones'}
          </p>
          <div className="tabla-scroll" tabIndex={0} role="region" aria-label="Listado de recepciones">
            <table className="tabla-lista">
              <thead>
                <tr>
                  <th>Recepción</th><th>Fecha</th><th>Guía</th><th>Lote</th><th>Proveedor / especie</th><th>Llegó</th>
                  <th className="num">Reportadas</th><th className="num">Planta</th><th className="num">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {datos.items.map((r) => (
                  <tr key={r.recepcion_id} className={`fila-${r.estado}`}>
                    <td><Link to={`/m01/${r.recepcion_id}`} aria-label={`Abrir la recepción ${r.recepcion_id}`}>{r.recepcion_id}</Link><br /><InsigniaEstado estado={r.estado} /></td>
                    <td>{formatoFecha(r.fecha_llegada)}</td>
                    <td data-testid="celda-guia">{r.guia_remision}</td>
                    <td>{r.lote_id}</td>
                    <td className="celda-ancha">{r.proveedor_nombre}<br /><span className="texto-suave">{r.especie_nombre}</span></td>
                    <td>{textoCantidad(r.num_gavetas_bines, r.llegada_en)}</td>
                    <td className="num">{r.libras_reportadas === null ? '—' : peso(Number(r.libras_reportadas))}</td>
                    <td className="num">{r.libras_planta === null ? '—' : peso(Number(r.libras_planta))}</td>
                    <td className={`num ${r.diferencia_lb !== null && Number(r.diferencia_lb) < 0 ? 'negativo' : ''}`}>
                      {r.diferencia_lb === null ? '—' : `${Number(r.diferencia_lb) > 0 ? '+' : ''}${peso(Number(r.diferencia_lb))}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {paginas > 1 && (
            <nav className="paginacion" aria-label="Páginas">
              <button type="button" className="boton-secundario" disabled={pagina <= 1}
                      onClick={() => cambiar({ pag: String(pagina - 1) }, false)}><Icono nombre="izquierda" tamano={18} />Anterior</button>
              <span data-testid="pagina-actual">Página {pagina} de {paginas}</span>
              <button type="button" className="boton-secundario" disabled={pagina >= paginas}
                      onClick={() => cambiar({ pag: String(pagina + 1) }, false)}>Siguiente<Icono nombre="derecha" tamano={18} /></button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
