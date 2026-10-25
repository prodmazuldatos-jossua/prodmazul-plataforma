import { ETIQUETA_ESTADO } from './mapeo';
import type { EstadoRecepcion } from './tipos';

export default function InsigniaEstado({ estado }: { estado: EstadoRecepcion }) {
  return <span className={`insignia-estado estado-${estado}`} data-testid="insignia-estado">{ETIQUETA_ESTADO[estado]}</span>;
}
