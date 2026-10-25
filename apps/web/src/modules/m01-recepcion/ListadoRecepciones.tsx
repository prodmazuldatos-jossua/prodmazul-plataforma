import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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

const POR_PAGINA = 20;
const ESTADOS_VALIDOS = ['activos', 'borrador', 'cerrado', 'anulado', 'todos', 'eliminado'];

export default function ListadoRecepciones() {
  const { puede } = useAuth();
  const { texto: peso } = useUnidad();
  const [params, setParams] = useSearchParams();
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
        <h1>Recepciones</h1>
        {puede('M01', 'crear') && <Link className="boton-primario enlace-boton" to="/m01/nueva">Nueva recepción</Link>}
      </div>

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
          <button type="button" className="boton-secundario" onClick={() => { setTexto(''); setParams({}, { replace: true }); }}>Quitar filtros</button>
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
          <div className="tabla-scroll">
            <table className="tabla-lista">
              <thead>
                <tr>
                  <th>Recepción</th><th>Fecha</th><th>Lote</th><th>Proveedor / especie</th><th>Llegó</th>
                  <th className="num">Reportadas</th><th className="num">Planta</th><th className="num">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {datos.items.map((r) => (
                  <tr key={r.recepcion_id} className={`fila-${r.estado}`}>
                    <td><Link to={`/m01/${r.recepcion_id}`} aria-label={`Abrir la recepción ${r.recepcion_id}`}>{r.recepcion_id}</Link><br /><InsigniaEstado estado={r.estado} /></td>
                    <td>{formatoFecha(r.fecha_llegada)}</td>
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
                      onClick={() => cambiar({ pag: String(pagina - 1) }, false)}>Anterior</button>
              <span data-testid="pagina-actual">Página {pagina} de {paginas}</span>
              <button type="button" className="boton-secundario" disabled={pagina >= paginas}
                      onClick={() => cambiar({ pag: String(pagina + 1) }, false)}>Siguiente</button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
