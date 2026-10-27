// Lógica pura de las pantallas de administración (sin pantalla): validación de parámetros, textos de la auditoría,
// filtros y paginación. La base de datos vuelve a validar todo: esto solo da respuesta rápida al escribir.
import type { FiltrosAuditoria, ItemCatalogo, ParametroConfig } from './api';

export const MOTIVO_MINIMO = 5;
export const MOTIVO_MAXIMO = 500;

export function errorMotivo(m: string): string | null {
  const t = m.trim();
  if (t.length < MOTIVO_MINIMO) return `El motivo debe tener al menos ${MOTIVO_MINIMO} caracteres.`;
  if (t.length > MOTIVO_MAXIMO) return `El motivo no puede superar los ${MOTIVO_MAXIMO} caracteres.`;
  return null;
}

/** Valida lo escrito para un parámetro. Devuelve el valor listo para enviar o el mensaje de error. */
export function validarParametro(p: Pick<ParametroConfig, 'tipo' | 'min' | 'max'>, texto: string): { ok: true; valor: number | string } | { ok: false; error: string } {
  const t = texto.trim();
  if (p.tipo === 'regex') {
    if (t === '') return { ok: false, error: 'El formato no puede estar vacío.' };
    if (t.length > 200) return { ok: false, error: 'El formato no puede superar 200 caracteres.' };
    if (!t.startsWith('^') || !t.endsWith('$')) return { ok: false, error: 'El formato debe empezar con ^ y terminar con $.' };
    try { new RegExp(t); } catch { return { ok: false, error: 'El formato no es una expresión regular válida.' }; }
    if (new RegExp(t).test('')) return { ok: false, error: 'El formato no puede aceptar un lote vacío.' };
    return { ok: true, valor: t };
  }
  if (t === '' || !/^-?\d+([.,]\d+)?$/.test(t)) return { ok: false, error: 'Escribe un número.' };
  const n = Number(t.replace(',', '.'));
  if (p.tipo === 'entero' && !Number.isInteger(n)) return { ok: false, error: 'Debe ser un número entero, sin decimales.' };
  if (p.tipo === 'decimal' && Math.abs(n * 1e5 - Math.round(n * 1e5)) > 1e-6) return { ok: false, error: 'Puede tener como máximo 5 decimales.' };
  if (p.min !== undefined && p.max !== undefined && (n < p.min || n > p.max)) return { ok: false, error: `Debe estar entre ${p.min} y ${p.max}.` };
  return { ok: true, valor: n };
}

export const textoValor = (v: number | string) => String(v);
export const esIgual = (a: number | string, b: number | string) => String(a) === String(b);

const ETIQUETAS: Record<string, string> = {
  cambiar_config: 'Cambió un parámetro', reabrir_lote: 'Reabrió un lote', cerrar_lote: 'Cerró un lote',
  unir_proveedor: 'Unió proveedores', unir_especie: 'Unió especies',
  crear: 'Creó una recepción', editar: 'Editó una recepción', anular: 'Anuló una recepción', eliminar: 'Eliminó una recepción',
  reactivar: 'Reactivó una recepción', devolver_a_borrador: 'Devolvió a borrador', exportar_excel: 'Exportó a Excel',
  subir_foto: 'Subió una foto', eliminar_foto: 'Quitó una foto', respaldar_foto: 'Respaldó una foto', purgar_foto: 'Purgó una foto',
  crear_usuario: 'Creó un usuario', actualizar_usuario: 'Guardó un usuario', cambiar_nombre_usuario: 'Cambió un nombre',
  cambiar_roles_usuario: 'Cambió un acceso', desactivar_usuario: 'Desactivó un usuario', reactivar_usuario: 'Reactivó un usuario',
  cambiar_clave_usuario: 'Cambió una contraseña',
  sync_programar: 'Programó el envío a Sheets', sync_pausar: 'Pausó el envío a Sheets', sync_ahora: 'Envió a Sheets ahora',
  sync_reencolar_todo: 'Reencoló todo para Sheets', sync_reintentar_errores: 'Reintentó errores de Sheets',
  purga_programar: 'Programó la purga', purga_pausar: 'Pausó la purga', purga_ahora: 'Purgó ahora',
};
export const etiquetaAccion = (a: string) => ETIQUETAS[a] ?? a.replace(/_/g, ' ');

export const MODULOS: Record<string, string> = { CORE: 'Sistema', M01: 'Recepción' };
export const etiquetaModulo = (m: string | null) => (m ? MODULOS[m] ?? m : '—');

const EVITAR = /^(clave|password|contrasena|contraseña)$/i;

/** Frase corta con lo más importante del detalle. Nunca muestra claves. */
export function resumenDetalle(accion: string, entidadId: string | null, d: Record<string, unknown> | null): string {
  const x = d ?? {};
  const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  switch (accion) {
    case 'cambiar_config': return `${s(entidadId)}: de ${s(x.antes)} a ${s(x.despues)}.`;
    case 'reabrir_lote': return `Lote ${s(entidadId)} · ${s(x.camiones)} camión(es) · motivo: ${s(x.motivo)}`;
    case 'unir_proveedor':
    case 'unir_especie': return `«${s(x.origen_nombre)}» → «${s(x.destino_nombre)}» · ${s(x.recepciones)} recepción(es), ${s(x.lotes)} lote(s) · motivo: ${s(x.motivo)}`;
    case 'anular': case 'eliminar': return x.motivo ? `Motivo: ${s(x.motivo)}` : '';
    default: {
      const partes = Object.entries(x).filter(([k, v]) => !EVITAR.test(k) && v !== null && typeof v !== 'object').slice(0, 4).map(([k, v]) => `${k}: ${s(v)}`);
      return partes.join(' · ');
    }
  }
}

export const FILTROS_VACIOS: FiltrosAuditoria = { desde: '', hasta: '', usuario: '', modulo: '', accion: '', texto: '' };
export const hayFiltros = (f: FiltrosAuditoria) => Object.values(f).some((v) => v.trim() !== '');

export function errorFiltros(f: FiltrosAuditoria): string | null {
  if (f.desde && f.hasta && f.desde > f.hasta) return 'La fecha «desde» no puede ser posterior a «hasta».';
  return null;
}

/** Parámetros para la consulta: solo los filtros con valor. */
export function paramsAuditoria(f: FiltrosAuditoria, pagina: number, porPagina = 30): Record<string, unknown> {
  const p: Record<string, unknown> = { pagina, por_pagina: porPagina };
  for (const k of ['desde', 'hasta', 'usuario', 'modulo', 'accion', 'texto'] as const) if (f[k].trim()) p[k] = f[k].trim();
  return p;
}

export const totalPaginas = (total: number, porPagina: number) => Math.max(1, Math.ceil(total / Math.max(1, porPagina)));
export function textoRango(total: number, pagina: number, porPagina: number): string {
  if (total === 0) return 'Sin resultados';
  const a = (pagina - 1) * porPagina + 1;
  return `${a}–${Math.min(total, pagina * porPagina)} de ${total}`;
}

/** Agrupa los nombres parecidos del catálogo (mismo «grupo»). */
export function gruposParecidos(items: ItemCatalogo[]): ItemCatalogo[][] {
  const m = new Map<string, ItemCatalogo[]>();
  for (const i of items) if (i.grupo) m.set(i.grupo, [...(m.get(i.grupo) ?? []), i]);
  return [...m.values()].filter((g) => g.length > 1);
}

/** Frase de confirmación antes de unir. */
export function textoUnion(tipo: 'proveedores' | 'especies', origen: ItemCatalogo, destino: ItemCatalogo): string {
  const que = tipo === 'proveedores' ? 'El proveedor' : 'La especie';
  return `«${origen.nombre}» (${origen.recepciones} recepciones, ${origen.lotes} lotes) se unirá a «${destino.nombre}». ${que} «${origen.nombre}» dejará de existir como nombre aparte; si alguien lo escribe de nuevo, el sistema usará «${destino.nombre}». Esto no se puede deshacer desde la pantalla.`;
}
