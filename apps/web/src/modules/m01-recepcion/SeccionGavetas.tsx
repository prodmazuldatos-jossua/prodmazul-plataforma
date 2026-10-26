import { PesoInput, useUnidad } from '../../lib/unidades';
import { pesosPresentes, promedioBloque, totalPesos } from './calculos';
import { NUM_GAVETAS_MAX, type Errores } from './tipos';
import { Icono } from '../../core/iconos';

interface Props {
  gavetas: (number | null)[];
  errores: Errores;
  onCambiar: (posicion: number, lb: number | null) => void;
}

/** Sección 2: 30 casillas de peso en tres bloques de 10, con promedio por bloque y total. */
export default function SeccionGavetas({ gavetas, errores, onCambiar }: Props) {
  const { texto } = useUnidad();
  const pesadas = pesosPresentes(gavetas).length;
  const siguiente = (i: number) => () => { document.getElementById(`gaveta-${Math.min(i + 2, NUM_GAVETAS_MAX)}`)?.focus(); };

  return (
    <section className="tarjeta tarjeta-ancha" id="seccion-gavetas" aria-labelledby="sec2" data-testid="seccion-gavetas">
      <h2 id="sec2" className="titulo-seccion"><Icono nombre="balanza" />2. Gavetas</h2>
      <p className="texto-suave">Escribe el peso de cada gaveta. Con <strong>Enter</strong> pasas a la siguiente. Las casillas que no uses se dejan vacías.</p>
      {errores.gavetas && <p className="error-campo" role="alert">{errores.gavetas}</p>}
      <div className="bloques-gavetas">
        {[0, 1, 2].map((b) => (
          <div className="bloque-gavetas" key={b}>
            {Array.from({ length: 10 }, (_, k) => {
              const i = b * 10 + k;
              return (
                <div className="fila-gaveta" key={i}>
                  <span className="num-gaveta" aria-hidden="true">{i + 1}</span>
                  <PesoInput id={`gaveta-${i + 1}`} compacto etiquetaAria={`Peso de la gaveta ${i + 1}`} value={gavetas[i]}
                             onChange={(v) => onCambiar(i, v)} alEnter={siguiente(i)} error={errores.filas?.gavetas[i]} />
                </div>
              );
            })}
            <p className="promedio-bloque">Peso promedio: <strong data-testid={`prom-bloque-${b + 1}`}>{promedioBloque(gavetas, b) === null ? '—' : texto(promedioBloque(gavetas, b))}</strong></p>
          </div>
        ))}
      </div>
      <div className="resumen-gavetas" aria-live="polite">
        <p>Gavetas pesadas: <strong data-testid="gavetas-pesadas">{pesadas}</strong> · Peso total de esas gavetas: <strong data-testid="gavetas-total">{pesadas === 0 ? '—' : texto(totalPesos(gavetas))}</strong></p>
        <p className="ayuda">Se pesa una muestra de gavetas para sacar el peso promedio; no tiene que coincidir con el total que llegó.</p>
      </div>
    </section>
  );
}
