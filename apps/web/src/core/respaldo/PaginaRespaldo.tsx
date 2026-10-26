import { useCallback, useEffect, useState } from 'react';
import { Alerta, Cargando, Vacio } from '../ui';
import { Icono } from '../iconos';
import { mensajeDe } from '../../lib/errores';
import { formatoFechaHora } from '../../lib/fechas';
import { obtenerErrores, reintentarErrores, respaldarAhora } from './api';
import { useRespaldo } from './usarRespaldo';
import {
  explicarError, motivosAlerta, segundosDesde, textoEstadoCorrida, textoHace, textoOrigen,
  type ErroresRespaldo, type ErrorFoto,
} from './respaldo';

const TITULO_NIVEL = {
  ok: 'Todo al día',
  aviso: 'Hay errores por revisar',
  alerta: 'El respaldo no está al día',
  apagada: 'El respaldo está apagado',
} as const;

function Dato({ etiqueta, valor, malo }: { etiqueta: string; valor: number | string; malo?: boolean }) {
  return (
    <div className={`dato-respaldo${malo ? ' dato-respaldo-malo' : ''}`}>
      <span className="dato-respaldo-valor">{valor}</span>
      <span className="dato-respaldo-etiqueta">{etiqueta}</span>
    </div>
  );
}

function TextoError({ texto }: { texto: string | null }) {
  const ex = explicarError(texto);
  return (
    <div className="error-respaldo">
      <p className="error-respaldo-titulo">{ex.titulo}</p>
      <p className="error-respaldo-ayuda">{ex.ayuda}</p>
      {texto && <details><summary>Ver el texto técnico</summary><p className="error-respaldo-tecnico">{texto}</p></details>}
    </div>
  );
}

function ListaFotos({ titulo, vacio, bloque, max }: { titulo: string; vacio: string; bloque: { total: number; items: ErrorFoto[] }; max: number }) {
  return (
    <section className="tarjeta tarjeta-ancha" aria-label={titulo}>
      <h3>{titulo} <span className="texto-suave">({bloque.total})</span></h3>
      {bloque.total === 0 ? <p className="texto-suave">{vacio}</p> : (
        <ul className="lista-errores">
          {bloque.items.map((f) => (
            <li key={f.foto_id}>
              <p><strong>{f.recepcion_id}</strong> · foto {f.foto_id.slice(-2)} · intento {Math.min(f.intentos, max)} de {max}
                {f.agotada ? <span className="etiqueta-agotada">Agotada</span> : f.proximo_intento_en ? <span className="texto-suave"> · próximo intento {formatoFechaHora(f.proximo_intento_en)}</span> : null}</p>
              <TextoError texto={f.ultimo_error} />
            </li>
          ))}
          {bloque.total > bloque.items.length && <li className="texto-suave">Se muestran las {bloque.items.length} más recientes.</li>}
        </ul>
      )}
    </section>
  );
}

export default function PaginaRespaldo() {
  const { resumen, recibidoMs, ahoraMs, nivel, error, cargando, recargar } = useRespaldo();
  const [errores, setErrores] = useState<ErroresRespaldo | null>(null);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'exito' | 'aviso' | 'error'; texto: string } | null>(null);

  const cargarDetalle = useCallback(async () => {
    try { setErrores(await obtenerErrores(50)); setErrorDetalle(null); } catch (e) { setErrorDetalle(mensajeDe(e)); }
  }, []);
  useEffect(() => { void cargarDetalle(); }, [cargarDetalle]);

  const actualizar = async () => { setMensaje(null); await Promise.all([recargar(), cargarDetalle()]); };

  const accion = async (hacer: () => Promise<string>) => {
    setTrabajando(true); setMensaje(null);
    try { setMensaje({ tipo: 'exito', texto: await hacer() }); }
    catch (e) { setMensaje({ tipo: 'error', texto: mensajeDe(e) }); }
    finally { setTrabajando(false); }
  };

  if (!resumen) {
    if (error) return <Vacio titulo="No se pudo cargar el estado del respaldo"><p>{error}</p><button type="button" className="boton-secundario" onClick={() => void actualizar()}>Reintentar</button></Vacio>;
    return <Cargando texto="Cargando el estado del respaldo…" />;
  }

  const seg = segundosDesde(resumen, recibidoMs, ahoraMs);
  const motivos = motivosAlerta(resumen, recibidoMs, ahoraMs);
  const max = errores?.maximo_intentos ?? 5;

  return (
    <>
      <h1>Estado del respaldo</h1>
      <p className="texto-suave">Cómo va la copia de los datos a Google Sheets y de las fotos a Drive. Los datos principales siempre están en Supabase.</p>

      {error && <Alerta tipo="aviso">No se pudo actualizar ahora ({error}). Se muestra el último dato conocido.</Alerta>}
      {mensaje && <Alerta tipo={mensaje.tipo}>{mensaje.texto}</Alerta>}

      <section className={`tarjeta tarjeta-ancha estado-respaldo estado-respaldo-${nivel}`} aria-live="polite" data-testid="estado-respaldo">
        <div className="estado-respaldo-cabeza">
          <Icono nombre={nivel === 'ok' ? 'ok' : nivel === 'aviso' ? 'alerta' : nivel === 'alerta' ? 'error' : 'info'} tamano={30} />
          <div>
            <h2>{nivel ? TITULO_NIVEL[nivel] : ''}</h2>
            <p>
              {!resumen.activa
                ? 'La sincronización automática no está programada (se enciende en la Parte 3 de la Fase 5).'
                : seg == null
                  ? 'Todavía no hay ninguna sincronización correcta.'
                  : <>Última sincronización correcta: <strong>{textoHace(seg)}</strong> ({formatoFechaHora(resumen.ultima_sync_ok_en)}).</>}
            </p>
            {motivos.length > 0 && <ul className="motivos-respaldo">{motivos.map((m) => <li key={m}>{m}</li>)}</ul>}
          </div>
        </div>
        <p className="texto-suave">El aviso en rojo aparece si pasan más de {resumen.limite_horas} horas sin respaldar. No se envían correos: se ve al abrir la aplicación.</p>
      </section>

      <section aria-label="Cifras" className="rejilla-respaldo">
        <Dato etiqueta="Cambios por enviar" valor={resumen.pendientes} />
        <Dato etiqueta="Envíos con error" valor={resumen.con_error} malo={resumen.con_error > 0} />
        <Dato etiqueta="Envíos agotados" valor={resumen.agotadas} malo={resumen.agotadas > 0} />
        <Dato etiqueta="Fotos sin respaldar" valor={resumen.fotos_sin_respaldo} />
        <Dato etiqueta="Fotos con error" valor={resumen.fotos_con_error} malo={resumen.fotos_con_error > 0} />
        <Dato etiqueta="Fotos agotadas" valor={resumen.fotos_agotadas} malo={resumen.fotos_agotadas > 0} />
        <Dato etiqueta="Errores de la purga" valor={resumen.purga_con_error + resumen.purga_agotadas} malo={resumen.purga_con_error + resumen.purga_agotadas > 0} />
        <Dato etiqueta="Purga de 60 días" valor={resumen.purga_activa ? 'Encendida' : 'Apagada'} />
      </section>

      {resumen.fotos_mas_antigua_en && (
        <p className="texto-suave">La foto que más espera respaldo se subió el {formatoFechaHora(resumen.fotos_mas_antigua_en)}.</p>
      )}

      <div className="acciones-fila">
        <button type="button" className="boton-secundario" onClick={() => void actualizar()} disabled={cargando || trabajando}><Icono nombre="reloj" />{cargando ? 'Actualizando…' : 'Actualizar'}</button>
        <button type="button" className="boton-primario" disabled={trabajando || !resumen.activa}
                onClick={() => void accion(async () => { await respaldarAhora(); return 'Se pidió una sincronización. Tarda alrededor de un minuto: espera y pulsa «Actualizar».'; })}>
          <Icono nombre="enviar" />Respaldar ahora
        </button>
        <button type="button" className="boton-secundario" disabled={trabajando || resumen.problemas === 0}
                onClick={() => void accion(async () => {
                  const r = await reintentarErrores();
                  await actualizar();
                  return `Listo: se quitó la espera de ${r.filas} ${r.filas === 1 ? 'envío' : 'envíos'} y ${r.fotos} ${r.fotos === 1 ? 'foto' : 'fotos'}. Se reintentarán en la próxima corrida (o pulsa «Respaldar ahora»).`;
                })}>
          <Icono nombre="reactivar" />Reintentar errores
        </button>
      </div>

      <h2 className="subtitulo">Detalle de errores</h2>
      {errorDetalle && <Alerta tipo="aviso">No se pudo cargar el detalle: {errorDetalle} <button type="button" className="boton-enlace" onClick={() => void cargarDetalle()}>Reintentar</button></Alerta>}
      {!errores && !errorDetalle && <Cargando texto="Cargando el detalle…" />}
      {errores && (
        <>
          {errores.datos.total + errores.fotos.total + errores.purga.total + errores.corridas.length === 0 && (
            <Alerta tipo="exito">No hay errores. Todo lo pendiente se enviará en la próxima corrida.</Alerta>
          )}

          <section className="tarjeta tarjeta-ancha" aria-label="Datos con error">
            <h3>Datos que no se pudieron enviar a Google Sheets <span className="texto-suave">({errores.datos.total})</span></h3>
            {errores.datos.total === 0 ? <p className="texto-suave">Ninguno.</p> : (
              <ul className="lista-errores">
                {errores.datos.items.map((c) => (
                  <li key={`${c.tabla}|${c.clave}|${c.cambiado_en}`}>
                    <p><strong>{c.clave}</strong> · {c.tabla.split('.').pop()} · {c.operacion === 'borrar' ? 'borrado' : 'cambio'} · intento {Math.min(c.intentos, max)} de {max}
                      {c.agotado ? <span className="etiqueta-agotada">Agotado</span> : c.proximo_intento_en ? <span className="texto-suave"> · próximo intento {formatoFechaHora(c.proximo_intento_en)}</span> : null}</p>
                    <TextoError texto={c.ultimo_error} />
                  </li>
                ))}
                {errores.datos.total > errores.datos.items.length && <li className="texto-suave">Se muestran los {errores.datos.items.length} más recientes.</li>}
              </ul>
            )}
          </section>

          <ListaFotos titulo="Fotos que no se pudieron respaldar en Drive" vacio="Ninguna." bloque={errores.fotos} max={max} />
          <ListaFotos titulo="Fotos que no se pudieron archivar (purga de 60 días)" vacio="Ninguna." bloque={errores.purga} max={max} />

          <section className="tarjeta tarjeta-ancha" aria-label="Corridas con problema">
            <h3>Últimas corridas con problema <span className="texto-suave">({errores.corridas.length})</span></h3>
            {errores.corridas.length === 0 ? <p className="texto-suave">Ninguna.</p> : (
              <ul className="lista-errores">
                {errores.corridas.map((c) => (
                  <li key={`${c.tipo}-${c.id}`}>
                    <p><strong>{c.tipo === 'purga' ? 'Purga de fotos' : 'Sincronización'}</strong> {textoOrigen(c.origen)} · {formatoFechaHora(c.pedida_en)} · {textoEstadoCorrida(c.estado)}</p>
                    <TextoError texto={c.error ?? (c.estado === 'sin_respuesta' ? 'La orden no fue atendida en 5 minutos.' : null)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {resumen.ultima_corrida && (
        <p className="texto-suave">Última corrida de sincronización: {textoOrigen(resumen.ultima_corrida.origen)}, {formatoFechaHora(resumen.ultima_corrida.pedida_en)}, {textoEstadoCorrida(resumen.ultima_corrida.estado)}.</p>
      )}
    </>
  );
}
