import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alerta, Cargando, Vacio } from '../ui';
import { Icono } from '../iconos';
import { mensajeDe } from '../../lib/errores';
import { formatoFechaHora } from '../../lib/fechas';
import { consultarAuditoria, type FiltrosAuditoria, type ListaAuditoria } from './api';
import { FILTROS_VACIOS, errorFiltros, etiquetaAccion, etiquetaModulo, hayFiltros, paramsAuditoria, resumenDetalle, textoRango, totalPaginas } from './administracion';

const OCULTAR = /^(clave|password|contrasena|contraseña)$/i;
const detalleSeguro = (d: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => !OCULTAR.test(k))), null, 2);

export default function PaginaAuditoria() {
  const [borrador, setBorrador] = useState<FiltrosAuditoria>(FILTROS_VACIOS);
  const [aplicados, setAplicados] = useState<FiltrosAuditoria>(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<ListaAuditoria | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const errFiltro = errorFiltros(borrador);

  const cargar = useCallback(async () => {
    setCargando(true);
    try { setDatos(await consultarAuditoria(paramsAuditoria(aplicados, pagina))); setError(null); }
    catch (e) { setError(mensajeDe(e)); }
    finally { setCargando(false); }
  }, [aplicados, pagina]);
  useEffect(() => { void cargar(); }, [cargar]);

  const buscar = (e: FormEvent) => { e.preventDefault(); if (errFiltro) return; setPagina(1); setAplicados({ ...borrador }); };
  const limpiar = () => { setBorrador(FILTROS_VACIOS); setAplicados(FILTROS_VACIOS); setPagina(1); };
  const poner = (k: keyof FiltrosAuditoria) => (e: { target: { value: string } }) => setBorrador((b) => ({ ...b, [k]: e.target.value }));
  const op = datos?.opciones;
  const paginas = datos ? totalPaginas(datos.total, datos.por_pagina) : 1;

  return (
    <div>
      <div className="encabezado-lista"><h1>Auditoría</h1></div>
      <p className="texto-suave">Registro de lo que se hizo en el sistema. Solo se puede consultar: nadie puede modificarlo ni borrarlo.</p>
      <form className="filtros-lista filtros-auditoria" onSubmit={buscar} aria-label="Filtros de la auditoría">
        <div className="campo"><label htmlFor="a-desde">Desde</label><input id="a-desde" type="date" value={borrador.desde} onChange={poner('desde')} /></div>
        <div className="campo"><label htmlFor="a-hasta">Hasta</label><input id="a-hasta" type="date" value={borrador.hasta} onChange={poner('hasta')} /></div>
        <div className="campo"><label htmlFor="a-usuario">Usuario</label>
          <select id="a-usuario" value={borrador.usuario} onChange={poner('usuario')}>
            <option value="">Todos</option>{op?.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select></div>
        <div className="campo"><label htmlFor="a-modulo">Módulo</label>
          <select id="a-modulo" value={borrador.modulo} onChange={poner('modulo')}>
            <option value="">Todos</option>{op?.modulos.map((m) => <option key={m} value={m}>{etiquetaModulo(m)}</option>)}
          </select></div>
        <div className="campo"><label htmlFor="a-accion">Acción</label>
          <select id="a-accion" value={borrador.accion} onChange={poner('accion')}>
            <option value="">Todas</option>{op?.acciones.map((a) => <option key={a} value={a}>{etiquetaAccion(a)}</option>)}
          </select></div>
        <div className="campo campo-busqueda"><label htmlFor="a-texto">Buscar (lote, recepción, parámetro…)</label>
          <input id="a-texto" type="search" value={borrador.texto} onChange={poner('texto')} autoComplete="off" /></div>
        <div className="acciones-filtro">
          <button type="submit" className="boton-primario" disabled={!!errFiltro}><Icono nombre="buscar" />Buscar</button>
          {(hayFiltros(borrador) || hayFiltros(aplicados)) && <button type="button" className="boton-secundario" onClick={limpiar}>Limpiar filtros</button>}
        </div>
      </form>
      {errFiltro && <Alerta tipo="error">{errFiltro}</Alerta>}
      {error && <Alerta tipo="error">{error}</Alerta>}
      {cargando && !datos && <Cargando />}
      {datos && (
        <>
          <p className="texto-suave" data-testid="rango-auditoria" aria-live="polite">{textoRango(datos.total, datos.pagina, datos.por_pagina)}</p>
          {datos.filas.length === 0 ? <Vacio titulo="No hay eventos con esos filtros" /> : (
            <div className="tabla-scroll">
              <table className="tabla-reporte tabla-auditoria">
                <caption className="visually-hidden">Eventos de auditoría</caption>
                <thead><tr><th>Fecha y hora</th><th>Quién</th><th>Módulo</th><th>Qué hizo</th><th>Detalle</th></tr></thead>
                <tbody>
                  {datos.filas.map((f) => (
                    <tr key={f.evento_id} data-testid="fila-auditoria">
                      <td>{formatoFechaHora(f.creado_en)}</td>
                      <td>{f.quien ?? 'Sistema'}</td>
                      <td>{etiquetaModulo(f.modulo)}</td>
                      <td>{etiquetaAccion(f.accion)}{f.entidad_id ? <span className="texto-suave"> · {f.entidad_id.length > 24 ? `${f.entidad_id.slice(0, 8)}…` : f.entidad_id}</span> : null}</td>
                      <td>
                        {resumenDetalle(f.accion, f.entidad_id, f.detalle)}
                        <details><summary>Ver todo</summary><pre className="detalle-json">{detalleSeguro(f.detalle)}</pre></details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="paginacion" role="navigation" aria-label="Páginas">
            <button type="button" className="boton-secundario" disabled={cargando || pagina <= 1} onClick={() => setPagina((p) => p - 1)}><Icono nombre="izquierda" />Anterior</button>
            <span>Página {datos.pagina} de {paginas}</span>
            <button type="button" className="boton-secundario" disabled={cargando || pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente<Icono nombre="derecha" /></button>
          </div>
        </>
      )}
    </div>
  );
}
