import { Link } from 'react-router-dom';
import { Alerta } from '../ui';
import { Icono } from '../iconos';
import { useRespaldo } from './usarRespaldo';
import { motivosAlerta } from './respaldo';

const ICONO = { ok: 'nube', aviso: 'alerta', alerta: 'error', apagada: 'nube' } as const;

/** «Respaldo: hace 5 minutos» en la barra superior (solo para quienes administran). */
export function IndicadorRespaldo() {
  const { resumen, nivel, texto, error } = useRespaldo();
  if (!resumen || !nivel) return null;
  const detalle = nivel === 'aviso' ? ` · ${resumen.problemas} ${resumen.problemas === 1 ? 'problema' : 'problemas'}` : '';
  return (
    <Link to="/admin/respaldo" className={`chip-respaldo respaldo-${nivel}`} data-testid="chip-respaldo"
          title={error ? 'No se pudo actualizar; se muestra el último dato conocido.' : 'Ver el estado del respaldo'}>
      <Icono nombre={ICONO[nivel]} tamano={16} />
      <span>{texto}{detalle}</span>
    </Link>
  );
}

/** Aviso en ROJO si pasan más de 6 horas sin respaldar. No tiene botón de cerrar: se va solo cuando el respaldo vuelve a funcionar. */
export function AvisoRespaldo() {
  const { resumen, nivel, recibidoMs, ahoraMs } = useRespaldo();
  if (!resumen || nivel !== 'alerta') return null;
  const motivos = motivosAlerta(resumen, recibidoMs, ahoraMs);
  return (
    <div data-testid="aviso-respaldo">
      <Alerta tipo="error">
        <strong>El respaldo en Google no está al día.</strong>{' '}
        {motivos.join(' ')} Tus datos están seguros en el sistema, pero la copia en Google está atrasada.{' '}
        <Link to="/admin/respaldo">Ver qué pasa</Link>
      </Alerta>
    </div>
  );
}
