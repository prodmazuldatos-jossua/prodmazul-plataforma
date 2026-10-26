// Prodmazul · Fase 5 · Partes 3 y 4 · Lógica del exportador (sin depender de Supabase ni de Deno, para poder probarla).
// Hace esto, en este orden:
//   1) pide a la base «el próximo lote» (sync_proximo_lote);
//   2) lo envía al receptor de Google (Apps Script) con el token;
//   3) si Google confirmó: sync_marcar_enviado; si no: sync_marcar_error (con reintentos y tope en la base);
//   4) repite mientras haya filas y quede tiempo;
//   5) (Parte 4) después, respalda las fotos confirmadas que aún no están en Drive: pide a la base las próximas fotos,
//      les crea una dirección temporal firmada, el receptor las descarga y las guarda en Drive, y SOLO si Drive confirma
//      se anota drive_file_id (sync_foto_marcar_ok); si no, sync_foto_marcar_error (con reintentos y tope en la base);
//   6) al final deja el resultado en sync_ejecuciones.
// Nunca escribe en las tablas de Recepción y nunca incluye el token en ningún mensaje de error.

export interface Respuesta { data: unknown; error: { message: string } | null }
export interface Dependencias {
  rpc: (nombre: string, args: Record<string, unknown>) => Promise<Respuesta>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  ahora: () => number;
  env: (nombre: string) => string | undefined;
  log: (mensaje: string) => void;
  /** Crea una dirección temporal (firmada) para descargar una foto privada de Supabase Storage. */
  firmar?: (ruta: string, segundos: number) => Promise<{ url?: string; error?: string }>;
}
export interface Opciones {
  origen?: string;
  ejecucion_id?: number | null;
  max_lotes?: number;          // lotes como máximo por ejecución
  tope_nuevo_lote_ms?: number; // no se empieza otro lote pasado este tiempo
  tope_total_ms?: number;      // la función entera no debe pasar de aquí
  tope_google_ms?: number;     // espera máxima por una respuesta de Google
  tope_google_fotos_ms?: number; // espera máxima por una tanda de fotos
  max_tandas_fotos?: number;   // tandas de fotos como máximo por ejecución
  fotos_por_tanda?: number;
  tope_nueva_tanda_ms?: number; // no se empieza otra tanda de fotos pasado este tiempo
  firma_segundos?: number;
}
export interface Resultado {
  ok: boolean;
  ejecucion_id: number | null;
  lotes: number;
  filas: number;
  quedan: number | null;
  fotos: number;
  fotos_error: number;
  quedan_fotos: number | null;
  error?: string;
  detalle: string[];
}

export const PREDETERMINADOS = {
  max_lotes: 10,
  tope_nuevo_lote_ms: 60_000,
  tope_total_ms: 135_000, // el plan gratuito corta a los 150 s
  tope_google_ms: 50_000,
  tope_google_fotos_ms: 90_000,
  max_tandas_fotos: 8,
  fotos_por_tanda: 5,
  tope_nueva_tanda_ms: 100_000,
  firma_segundos: 600,
};

const PREFIJO_URL = 'https://script.google.com/macros/s/';

/** Quita el token (y la URL) de cualquier texto antes de guardarlo o mostrarlo. */
export function limpiar(texto: string, secretos: Array<string | undefined>): string {
  let t = String(texto ?? '');
  for (const s of secretos) {
    if (s && s.length >= 6) t = t.split(s).join('«oculto»');
  }
  return t.replace(/\s+/g, ' ').trim().slice(0, 400);
}

/** Comparación en tiempo constante (no revela cuántos caracteres coinciden). */
export function mismoSecreto(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

export function configuracionGoogle(env: (n: string) => string | undefined): { url: string; token: string } | { error: string } {
  const url = (env('APPS_SCRIPT_URL') ?? '').trim();
  const token = (env('APPS_SCRIPT_TOKEN') ?? '').trim();
  if (!url) return { error: 'Falta el secreto APPS_SCRIPT_URL en las funciones de Supabase.' };
  if (!token) return { error: 'Falta el secreto APPS_SCRIPT_TOKEN en las funciones de Supabase.' };
  if (!url.startsWith(PREFIJO_URL) || !url.endsWith('/exec')) {
    return { error: 'APPS_SCRIPT_URL no parece la dirección del receptor (debe empezar con https://script.google.com/macros/s/ y terminar en /exec).' };
  }
  return { url, token };
}

/** Envía un cuerpo al receptor y devuelve su respuesta ya interpretada. Nunca lanza error. */
export async function llamarGoogle(
  d: Dependencias, cfg: { url: string; token: string }, cuerpo: Record<string, unknown>, esperaMs: number,
): Promise<{ ok: boolean; datos?: Record<string, unknown>; error?: string }> {
  let resp: Response;
  try {
    resp = await d.fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ...cuerpo, token: cfg.token }),
      redirect: 'follow',
      signal: AbortSignal.timeout(Math.max(1, esperaMs)),
    });
  } catch (e) {
    const nombre = (e as { name?: string })?.name;
    const msg = nombre === 'TimeoutError' || nombre === 'AbortError'
      ? `Google no respondió en ${Math.round(esperaMs / 1000)} segundos`
      : `No se pudo conectar con Google (${(e as Error)?.message ?? e})`;
    return { ok: false, error: limpiar(msg, [cfg.token, cfg.url]) };
  }
  let texto = '';
  try { texto = await resp.text(); } catch (e) {
    return { ok: false, error: limpiar(`Se cortó la respuesta de Google (${(e as Error)?.message ?? e})`, [cfg.token, cfg.url]) };
  }
  let datos: Record<string, unknown>;
  try { datos = JSON.parse(texto); } catch {
    const pista = resp.status >= 400 ? `código ${resp.status}` : 'no es JSON; revisa que la implementación sea «Cualquier persona» y la URL termine en /exec';
    return { ok: false, error: limpiar(`Respuesta no válida del receptor (${pista})`, [cfg.token, cfg.url]) };
  }
  if (datos && datos.ok === true) return { ok: true, datos };
  const motivo = datos && typeof datos.error === 'string' ? datos.error : 'el receptor respondió que no';
  const extra = datos && datos.parcial === true ? ` (faltan ${datos.faltan ?? '?'} filas; se reintentará)` : '';
  return { ok: false, datos, error: limpiar(`Google: ${motivo}${extra}`, [cfg.token, cfg.url]) };
}

export async function ejecutar(d: Dependencias, opc: Opciones = {}): Promise<Resultado> {
  const o = { ...PREDETERMINADOS, ...opc };
  const t0 = d.ahora();
  const r: Resultado = { ok: true, ejecucion_id: null, lotes: 0, filas: 0, quedan: null, fotos: 0, fotos_error: 0, quedan_fotos: null, detalle: [] };
  const secretosVarios = [d.env('APPS_SCRIPT_TOKEN'), d.env('APPS_SCRIPT_URL'), d.env('SYNC_SECRETO')];

  const abrir = await d.rpc('sync_ejecucion_abrir', { p_id: o.ejecucion_id ?? null, p_origen: o.origen ?? 'manual' });
  if (abrir.error) {
    return { ...r, ok: false, error: limpiar(`No se pudo abrir la ejecución: ${abrir.error.message}`, secretosVarios) };
  }
  r.ejecucion_id = Number(abrir.data);

  const cerrar = async (): Promise<Resultado> => {
    const c = await d.rpc('sync_ejecucion_cerrar', {
      p_id: r.ejecucion_id, p_estado: r.ok ? 'ok' : 'con_error', p_lotes: r.lotes, p_filas: r.filas, p_error: r.error ?? null,
      p_fotos: r.fotos, p_fotos_error: r.fotos_error,
    });
    if (!c.error && c.data && typeof c.data === 'object') {
      const cd = c.data as { quedan?: number; quedan_fotos?: number };
      r.quedan = Number(cd.quedan ?? 0); r.quedan_fotos = Number(cd.quedan_fotos ?? 0);
    }
    else if (c.error) r.detalle.push(`No se pudo cerrar la ejecución: ${limpiar(c.error.message, secretosVarios)}`);
    return r;
  };
  const fallar = async (msg: string): Promise<Resultado> => {
    r.ok = false; r.error = limpiar(msg, secretosVarios); d.log(`sync-exportar: ${r.error}`); return await cerrar();
  };

  const cfg = configuracionGoogle(d.env);
  if ('error' in cfg) return await fallar(cfg.error);

  for (let i = 0; i < o.max_lotes; i++) {
    if (i > 0 && d.ahora() - t0 > o.tope_nuevo_lote_ms) { r.detalle.push('Se detuvo por tiempo; el resto sigue en la cola para la próxima ejecución.'); break; }

    const p = await d.rpc('sync_proximo_lote', { p_max: null });
    if (p.error) return await fallar(`La base no entregó el lote: ${p.error.message}`);
    const lote = p.data as { vacio?: boolean; lote_id?: string; filas?: number; tablas?: unknown[] };
    if (!lote || lote.vacio) { r.detalle.push('No hay más filas por enviar.'); break; }

    const restante = o.tope_total_ms - (d.ahora() - t0);
    const espera = Math.min(o.tope_google_ms, restante);
    const g = await llamarGoogle(d, cfg, { accion: 'sincronizar', lote_id: lote.lote_id, tablas: lote.tablas }, espera);

    if (g.ok) {
      const m = await d.rpc('sync_marcar_enviado', { p_lote: lote.lote_id });
      if (m.error) {
        // Google ya lo escribió; si la base no pudo confirmarlo, el lote se reenviará y se actualizará sin duplicar.
        return await fallar(`Google recibió el lote ${lote.lote_id}, pero la base no pudo confirmarlo: ${m.error.message}`);
      }
      r.lotes += 1; r.filas += Number(lote.filas ?? 0);
      r.detalle.push(`Lote ${i + 1}: ${lote.filas ?? 0} filas enviadas.`);
    } else {
      const m = await d.rpc('sync_marcar_error', { p_lote: lote.lote_id, p_error: g.error ?? 'Error sin detalle' });
      const extra = m.error ? ` (además, la base no pudo anotar el error: ${m.error.message})` : '';
      return await fallar(`${g.error}${extra}`);
    }
  }
  await respaldarFotos(d, cfg, o, t0, r, secretosVarios);
  return await cerrar();
}

interface FotoPendiente { foto_id: string; recepcion_id: string; lote_id?: string; nn: number; ruta: string; tipo_mime: string; bytes_esperados: number | null }
interface ResultadoFoto { foto_id: string; ok?: boolean; drive_file_id?: string; bytes?: number; reutilizada?: boolean; pendiente?: boolean; error?: string }

/** Fase de fotos: nunca hace fallar la ejecución de datos; cada foto lleva su propio resultado en la base. */
async function respaldarFotos(
  d: Dependencias, cfg: { url: string; token: string }, o: typeof PREDETERMINADOS & Opciones, t0: number, r: Resultado, secretos: Array<string | undefined>,
): Promise<void> {
  if (!d.firmar) { r.detalle.push('Fotos: esta función no tiene cómo crear direcciones temporales; no se respaldaron fotos.'); return; }
  const marcarError = async (foto_id: string, msg: string) => {
    const m = await d.rpc('sync_foto_marcar_error', { p_foto_id: foto_id, p_error: limpiar(msg, secretos) });
    r.fotos_error += 1;
    if (m.error) r.detalle.push(`Fotos: no se pudo anotar el error de ${foto_id}: ${limpiar(m.error.message, secretos)}`);
  };
  for (let tanda = 0; tanda < o.max_tandas_fotos; tanda++) {
    if (d.ahora() - t0 > o.tope_nueva_tanda_ms) { r.detalle.push('Fotos: se detuvo por tiempo; el resto sigue pendiente para la próxima ejecución.'); return; }
    const p = await d.rpc('sync_fotos_pendientes', { p_max: o.fotos_por_tanda });
    if (p.error) { r.detalle.push(`Fotos: la base no entregó las fotos: ${limpiar(p.error.message, secretos)}`); return; }
    const lista = (p.data as { vacio?: boolean; fotos?: FotoPendiente[] }) ?? {};
    if (!lista.fotos || lista.vacio || lista.fotos.length === 0) { if (tanda === 0) r.detalle.push('Fotos: no hay fotos por respaldar.'); return; }

    // 1) direcciones temporales
    const envio: Array<Record<string, unknown>> = [];
    for (const f of lista.fotos) {
      const fir = await d.firmar(f.ruta, o.firma_segundos);
      if (!fir.url) { await marcarError(f.foto_id, `No se pudo crear la dirección temporal de la foto (${fir.error ?? 'sin detalle'})`); continue; }
      envio.push({ foto_id: f.foto_id, recepcion_id: f.recepcion_id, nn: f.nn, ruta: f.ruta, tipo_mime: f.tipo_mime, bytes_esperados: f.bytes_esperados, url: fir.url });
    }
    if (envio.length === 0) continue;

    // 2) el receptor descarga y guarda en Drive
    const restante = o.tope_total_ms - (d.ahora() - t0);
    const g = await llamarGoogle(d, cfg, { accion: 'guardar_fotos', fotos: envio }, Math.min(o.tope_google_fotos_ms, restante));
    if (!g.ok) {
      for (const f of envio) await marcarError(String(f.foto_id), g.error ?? 'Error sin detalle');
      r.detalle.push(`Fotos: tanda ${tanda + 1} con error (${g.error}).`);
      return; // si Google falla, no se insiste en esta ejecución
    }

    // 3) solo lo que Drive confirmó se anota como respaldado
    const resultados = (g.datos?.resultados as ResultadoFoto[] | undefined) ?? [];
    const porId = new Map(resultados.map((x) => [x.foto_id, x]));
    let buenas = 0;
    for (const f of envio) {
      const x = porId.get(String(f.foto_id));
      if (x?.ok === true && typeof x.drive_file_id === 'string') {
        const m = await d.rpc('sync_foto_marcar_ok', { p_foto_id: f.foto_id, p_drive_file_id: x.drive_file_id, p_bytes: x.bytes ?? null });
        if (m.error) { await marcarError(String(f.foto_id), `Drive guardó la foto pero la base no pudo confirmarlo: ${m.error.message}`); }
        else { r.fotos += 1; buenas += 1; }
      } else if (x?.pendiente === true) {
        r.detalle.push(`Fotos: ${f.foto_id} quedó para la próxima ejecución (el receptor se quedó sin tiempo).`);
      } else {
        await marcarError(String(f.foto_id), x?.error ?? 'El receptor no devolvió resultado para esta foto');
      }
    }
    r.detalle.push(`Fotos: tanda ${tanda + 1}: ${buenas} de ${envio.length} respaldadas.`);
    if (resultados.some((x) => x.pendiente === true)) return;
  }
}

/** Prueba de conexión con el receptor (no toca la cola). */
export async function probarGoogle(d: Dependencias): Promise<{ ok: boolean; version?: string; error?: string }> {
  const cfg = configuracionGoogle(d.env);
  if ('error' in cfg) return { ok: false, error: cfg.error };
  const g = await llamarGoogle(d, cfg, { accion: 'ping' }, PREDETERMINADOS.tope_google_ms);
  if (!g.ok) return { ok: false, error: g.error };
  return { ok: true, version: String(g.datos?.version ?? '') };
}
