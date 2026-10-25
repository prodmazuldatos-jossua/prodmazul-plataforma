import { PesoInput, useUnidad } from '../../lib/unidades';
import { TemperaturaInput } from './controles';
import { totalLibrasAprox } from './calculos';
import { MAX_FILAS_ALMACENAMIENTO, filaAlmacenamientoVacia, type AlmacenamientoForm, type Errores } from './tipos';

interface Props {
  filas: AlmacenamientoForm[];
  errores: Errores;
  onCambiar: (filas: AlmacenamientoForm[]) => void;
}

/** Sección 4: almacenamiento de materia prima. Filas con bin, sellos, temperatura y libras aproximadas. */
export default function SeccionAlmacenamiento({ filas, errores, onCambiar }: Props) {
  const { texto } = useUnidad();
  const cambiarFila = (i: number, cambio: Partial<AlmacenamientoForm>) => onCambiar(filas.map((f, k) => (k === i ? { ...f, ...cambio } : f)));
  const agregar = () => onCambiar([...filas, filaAlmacenamientoVacia()]);
  const quitar = (i: number) => onCambiar(filas.length <= 1 ? [filaAlmacenamientoVacia()] : filas.filter((_, k) => k !== i));
  const total = totalLibrasAprox(filas);

  return (
    <section className="tarjeta tarjeta-ancha" id="seccion-almacenamiento" aria-labelledby="sec4" data-testid="seccion-almacenamiento">
      <h2 id="sec4">4. Almacenamiento de materia prima</h2>
      <p className="texto-suave">Una fila por bin. Los números de bin y los sellos no se pueden repetir dentro de la misma recepción. Las filas vacías se ignoran.</p>
      <div className="filas-almacenamiento">
        {filas.map((f, i) => {
          const e = errores.filas?.almacenamiento[i] ?? {};
          return (
            <div className="fila-alm" key={i} data-testid={`fila-alm-${i + 1}`}>
              <p className="fila-alm-titulo">Bin {i + 1}</p>
              <div className="rejilla-alm">
                <div className="campo campo-compacto">
                  <label htmlFor={`alm-${i}-bin`}>N.º de bin</label>
                  <input id={`alm-${i}-bin`} type="text" value={f.num_bin} autoComplete="off" maxLength={20}
                         aria-invalid={Boolean(e.num_bin)} aria-describedby={e.num_bin ? `alm-${i}-bin-error` : undefined}
                         onChange={(ev) => cambiarFila(i, { num_bin: ev.target.value.toUpperCase() })} />
                  {e.num_bin && <p className="error-campo" id={`alm-${i}-bin-error`}>{e.num_bin}</p>}
                </div>
                <div className="campo campo-compacto">
                  <label htmlFor={`alm-${i}-sr`}>N.º de sello de recepción</label>
                  <input id={`alm-${i}-sr`} type="text" value={f.sellos_recepcion} autoComplete="off" maxLength={40}
                         aria-invalid={Boolean(e.sellos_recepcion)} aria-describedby={e.sellos_recepcion ? `alm-${i}-sr-error` : undefined}
                         onChange={(ev) => cambiarFila(i, { sellos_recepcion: ev.target.value })} />
                  {e.sellos_recepcion && <p className="error-campo" id={`alm-${i}-sr-error`}>{e.sellos_recepcion}</p>}
                </div>
                <div className="campo campo-compacto">
                  <label htmlFor={`alm-${i}-sa`}>N.º de sello de almacenamiento</label>
                  <input id={`alm-${i}-sa`} type="text" value={f.sellos_almacenamiento} autoComplete="off" maxLength={40}
                         aria-invalid={Boolean(e.sellos_almacenamiento)} aria-describedby={e.sellos_almacenamiento ? `alm-${i}-sa-error` : undefined}
                         onChange={(ev) => cambiarFila(i, { sellos_almacenamiento: ev.target.value })} />
                  {e.sellos_almacenamiento && <p className="error-campo" id={`alm-${i}-sa-error`}>{e.sellos_almacenamiento}</p>}
                </div>
                <div>
                  <p className="etiqueta-falsa">Temperatura (°C)</p>
                  <TemperaturaInput id={`alm-${i}-temp`} etiquetaAria={`Temperatura del bin ${i + 1}`} value={f.temperatura_c}
                                    onChange={(v) => cambiarFila(i, { temperatura_c: v })} error={e.temperatura_c} />
                </div>
                <PesoInput id={`alm-${i}-lb`} compacto etiqueta="Libras aproximadas" value={f.libras_aprox}
                           onChange={(v) => cambiarFila(i, { libras_aprox: v })} error={e.libras_aprox} />
              </div>
              <button type="button" className="boton-enlace" onClick={() => quitar(i)} aria-label={`Quitar el bin ${i + 1}`}>Quitar este bin</button>
            </div>
          );
        })}
      </div>
      <div className="acciones-fila">
        <button type="button" className="boton-secundario" onClick={agregar} disabled={filas.length >= MAX_FILAS_ALMACENAMIENTO}>+ Agregar bin</button>
        <p className="total-alm">Libras aproximadas en total: <strong data-testid="alm-total">{total === 0 ? '—' : texto(total)}</strong></p>
      </div>
    </section>
  );
}
