import { useUnidad } from '../../lib/unidades';
import { diferenciaLb, diferenciaPct, duracionMin, pesoPromedio, pesosPresentes, textoDuracion } from './calculos';
import type { FormRecepcion } from './tipos';

/** Cálculos en vivo: cambian mientras se escribe. Se muestran en la unidad elegida (Lb o Kg). */
export default function PanelCalculos({ f }: { f: FormRecepcion }) {
  const { texto } = useUnidad();
  const dif = diferenciaLb(f.libras_reportadas, f.libras_planta);
  const pct = diferenciaPct(f.libras_reportadas, f.libras_planta);
  const dur = duracionMin(f.hora_inicio_descarga, f.hora_fin_descarga);
  const prom = pesoPromedio(pesosPresentes(f.gavetas));
  const signo = (n: number) => (n > 0 ? '+' : '');
  const clase = dif === null ? '' : dif < 0 ? 'negativo' : dif > 0 ? 'positivo' : '';

  return (
    <section className="panel-calculos" aria-label="Cálculos en vivo" data-testid="panel-calculos">
      <h2>Cálculos</h2>
      <dl>
        <div><dt>Diferencia (planta − reportadas)</dt>
          <dd className={clase} data-testid="calc-diferencia">{dif === null ? '—' : `${signo(dif)}${texto(dif)}`}</dd></div>
        <div><dt>Diferencia en %</dt>
          <dd className={clase} data-testid="calc-pct">{pct === null ? '—' : `${signo(pct)}${pct.toFixed(2)} %`}</dd></div>
        <div><dt>Peso promedio por gaveta</dt>
          <dd data-testid="calc-promedio">{prom === null ? '— (pesa las gavetas)' : texto(prom)}</dd></div>
        <div><dt>Duración de la descarga</dt>
          <dd data-testid="calc-duracion">{dur === null ? '—' : textoDuracion(dur)}</dd></div>
      </dl>
    </section>
  );
}
