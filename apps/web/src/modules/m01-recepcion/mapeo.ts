import { gavetasVisibles } from './calculos';
import { filaAlmacenamientoVacia, gavetasVacias, lecturasVacias, type EstadoRecepcion, type FormRecepcion, type RecepcionDetalle } from './tipos';

/** Convierte la recepción que devuelve la base de datos al estado del formulario (para editarla). */
export function recepcionAForm(r: RecepcionDetalle): FormRecepcion {
  const gavetas = gavetasVacias();
  for (const g of r.gavetas) if (g.num_gaveta >= 1 && g.num_gaveta <= gavetas.length) gavetas[g.num_gaveta - 1] = Number(g.peso_lb);
  const temperaturas = r.temperaturas.map((t) => ({ num_gaveta: t.num_gaveta, temperatura_c: Number(t.temperatura_c) }));
  const almacenamiento = r.almacenamiento.map((a) => ({
    num_bin: a.num_bin ?? '', sellos_recepcion: a.sellos_recepcion ?? '', sellos_almacenamiento: a.sellos_almacenamiento ?? '',
    temperatura_c: a.temperatura_c === null ? null : Number(a.temperatura_c),
    libras_aprox: a.libras_aprox === null ? null : Number(a.libras_aprox),
  }));
  const num = (v: number | string | null) => (v === null || v === undefined ? null : Number(v));
  const visibles = gavetasVisibles({ gavetas, temperaturas });
  return {
    fecha_llegada: r.fecha_llegada.slice(0, 10),
    placa_vehiculo: r.placa_vehiculo ?? '',
    lote_id: r.lote_id,
    proveedor: r.proveedor_nombre,
    especie: r.especie_nombre,
    piscina: r.piscina ?? '',
    guia_remision: r.guia_remision,
    llegada_en: r.llegada_en === 'gavetas' ? 'gavetas' : 'bines',
    num_gavetas_bines: String(r.num_gavetas_bines),
    libras_reportadas: num(r.libras_reportadas),
    libras_planta: num(r.libras_planta),
    hora_inicio_descarga: r.hora_inicio_descarga ? r.hora_inicio_descarga.slice(0, 5) : '',
    hora_fin_descarga: r.hora_fin_descarga ? r.hora_fin_descarga.slice(0, 5) : '',
    observacion: r.observacion ?? '',
    gavetas,
    gavetas_visibles: visibles,
    temperaturas: temperaturas.length > 0 ? temperaturas : lecturasVacias(),
    almacenamiento: almacenamiento.length > 0 ? almacenamiento : [filaAlmacenamientoVacia()],
    cerrar_lote: false,
  };
}

export interface Capacidades { editar: boolean; devolver: boolean; anular: boolean; eliminar: boolean; reactivar: boolean }

/**
 * Qué botones se ofrecen. Reglas iguales a las de la base de datos:
 * editar y anular piden el permiso y ser quien la creó (o tener «eliminar»); eliminar y reactivar piden «eliminar».
 */
export function capacidades(
  r: { estado: EstadoRecepcion; creado_por: string | null },
  usuarioId: string | undefined,
  puede: (permiso: string) => boolean,
): Capacidades {
  const esAutor = Boolean(usuarioId) && r.creado_por === usuarioId;
  const admin = puede('eliminar');
  const activa = r.estado === 'borrador' || r.estado === 'cerrado';
  return {
    editar: activa && puede('editar') && (esAutor || admin),
    devolver: r.estado === 'cerrado' && puede('editar') && (esAutor || admin),
    anular: activa && puede('anular') && (esAutor || admin),
    eliminar: r.estado !== 'eliminado' && admin,
    reactivar: (r.estado === 'anulado' || r.estado === 'eliminado') && admin,
  };
}

export const ETIQUETA_ESTADO: Record<EstadoRecepcion, string> = {
  borrador: 'Borrador', cerrado: 'Cerrada', anulado: 'Anulada', eliminado: 'Eliminada',
};

/** Página actual (1, 2, …) y total de páginas a partir del desplazamiento. */
export function paginacion(total: number, desplazamiento: number, limite: number): { pagina: number; paginas: number } {
  const paginas = Math.max(1, Math.ceil(total / limite));
  return { pagina: Math.min(paginas, Math.floor(desplazamiento / limite) + 1), paginas };
}
