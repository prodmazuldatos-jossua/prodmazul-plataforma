import { PesoInput, useUnidad } from '../../lib/unidades';
import { pesosPresentes, promedioBloque, totalPesos } from './calculos';
import { GAVETAS_INICIALES, NUM_GAVETAS_MAX, type Errores } from './tipos';
import { Icono } from '../../core/iconos';

interface Props {
  gavetas: (number | null)[];
  /** Cuántas casillas se muestran (2 al empezar). */
  visibles: number;
  errores: Errores;
  onCambiar: (posicion: number, lb: number | null) => void;
  onAgregar: () => void;
  onQuitar: () => void;
  /** true si la última gaveta tiene una temperatura asignada: no se puede quitar. */
  ultimaConTemperatura: boolean;
}

/**
 * Sección 2: casillas de peso de las gavetas. Empieza con 2; «+ Agregar gaveta» suma una más (hasta 30).
 * Las casillas se reparten en bloques de 10 (1-10, 11-20, 21-30) y cada bloque aparece solo cuando se necesita.
 * El peso es opcional.
 */
export default function SeccionGavetas({ gavetas, visibles, errores, onCambiar, onAgregar, onQuitar, ultimaConTemperatura }: Props) {
  const { texto } = useUnidad();
  const pesadas = pesosPresentes(gavetas).length;
  const siguiente = (i: number) => () => { document.getElementById(`gaveta-${Math.min(i + 2, visibles)}`)?.focus(); };
  const bloques = Math.ceil(visibles / 10);
  const ultimaConPeso = gavetas[visibles - 1] !== null;
  const noSePuedeQuitar = visibles <= GAVETAS_INICIALES || ultimaConPeso || ultimaConTemperatura;

  return (
    <section className="tarjeta tarjeta-ancha" id="seccion-gavetas" aria-labelledby="sec2" data-testid="seccion-gavetas">
      <h2 id="sec2" className="titulo-seccion"><Icono nombre="balanza" />2. Gavetas</h2>
      <p className="texto-suave">
        Escribe el peso de las gavetas que pesaste (es opcional). Con <strong>Enter</strong> pasas a la siguiente.
        Si necesitas más casillas, presiona <strong>+ Agregar gaveta</strong>.
      </p>
      {errores.gavetas && <p className="error-campo" role="alert">{errores.gavetas}</p>}
      <div className="bloques-gavetas">
        {Array.from({ length: bloques }, (_, b) => {
          const prom = promedioBloque(gavetas, b);
          return (
            <div className="bloque-gavetas" key={b} data-testid={`bloque-gavetas-${b + 1}`}>
              {Array.from({ length: Math.min(10, visibles - b * 10) }, (_, k) => {
                const i = b * 10 + k;
                return (
                  <div className="fila-gaveta" key={i}>
                    <span className="num-gaveta" aria-hidden="true">{i + 1}</span>
                    <PesoInput id={`gaveta-${i + 1}`} compacto etiquetaAria={`Peso de la gaveta ${i + 1}`} value={gavetas[i]}
                               onChange={(v) => onCambiar(i, v)} alEnter={siguiente(i)} error={errores.filas?.gavetas[i]} />
                  </div>
                );
              })}
              <p className="promedio-bloque">Peso promedio: <strong data-testid={`prom-bloque-${b + 1}`}>{prom === null ? '—' : texto(prom)}</strong></p>
            </div>
          );
        })}
      </div>
      <div className="acciones-fila">
        <button type="button" className="boton-secundario" data-testid="agregar-gaveta" onClick={onAgregar} disabled={visibles >= NUM_GAVETAS_MAX}>+ Agregar gaveta</button>
        {visibles > GAVETAS_INICIALES && (
          <button type="button" className="boton-enlace" data-testid="quitar-gaveta" onClick={onQuitar} disabled={noSePuedeQuitar}
                  title={noSePuedeQuitar ? 'Solo se puede quitar la última gaveta si está vacía y sin temperatura' : undefined}>
            Quitar la última gaveta
          </button>
        )}
        <p className="texto-suave" data-testid="gavetas-mostradas">Gavetas en pantalla: {visibles} de {NUM_GAVETAS_MAX}</p>
      </div>
      <div className="resumen-gavetas" aria-live="polite">
        <p>Gavetas pesadas: <strong data-testid="gavetas-pesadas">{pesadas}</strong> · Peso total de esas gavetas: <strong data-testid="gavetas-total">{pesadas === 0 ? '—' : texto(totalPesos(gavetas))}</strong></p>
        <p className="ayuda">Se pesa una muestra de gavetas para sacar el peso promedio; no tiene que coincidir con el total que llegó.</p>
      </div>
    </section>
  );
}
