/** Error de negocio devuelto por la base de datos con el formato 'CODIGO|Mensaje'. */
export class ApiError extends Error {
  codigo: string;
  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.codigo = codigo;
  }
}

export function esErrorDeRed(e: unknown): boolean {
  if (e instanceof ApiError) return e.codigo === 'E_RED';
  const m = String((e as { message?: string })?.message ?? e).toLowerCase();
  return m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed') || m.includes('network request failed')
    || m.includes('aborterror') || m.includes('timeouterror') || m.includes('signal timed out') || m.includes('the user aborted');
}

/** Convierte cualquier error de Supabase en un ApiError con mensaje en español. */
/** Palabras de infraestructura que el usuario final nunca debe ver. */
const TEXTO_TECNICO = /supabase|vault|secreto|cloudflare|apps ?script|edge function|\.env|migraci[oó]n|service_role|bucket/i;

export function aApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (esErrorDeRed(e)) return new ApiError('E_RED', 'No hay conexión con el servidor.');
  const bruto = String((e as { message?: string })?.message ?? e);
  const m = /^(E_[A-Z_]+)\|(.*)$/s.exec(bruto);
  if (m) return new ApiError(m[1], m[1] === 'E_CONFIG' || TEXTO_TECNICO.test(m[2]) ? 'No se pudo completar la acción. Intenta más tarde o avisa al administrador.' : m[2]);
  if (/jwt|not authenticated|permission denied|invalid token/i.test(bruto)) {
    return new ApiError('E_SESION', 'Tu sesión venció. Vuelve a iniciar sesión.');
  }
  return new ApiError('E_DESCONOCIDO', 'Ocurrió un error inesperado. Intenta de nuevo.');
}

export function mensajeDe(e: unknown): string {
  return aApiError(e).message;
}
