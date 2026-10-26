import { TemperaturaInput } from './controles';
import { gavetasConPeso } from './esquema';
import { useUnidad } from '../../lib/unidades';
import { MAX_LECTURAS, lecturaVacia, type Errores, type LecturaForm } from './tipos';
import { Icono } from '../../core/iconos';

interface Props {
  lecturas: LecturaForm[];
  gavetas: (number | null)[];
  errores: Errores;
  onCambiar: (lecturas: LecturaForm[]) => void;
}

/** Sección 3: temperatura de referencia de algunas gavetas. Por defecto 2 filas; se pueden agregar más. */
export default function SeccionTemperaturas({ lecturas, gavetas, errores, onCambiar }: Props) {
  const { texto } = useUnidad();
  const conPeso = gavetasConPeso(gavetas);
  const cambiar = (i: number, c: Partial<LecturaForm>) => onCambiar(lecturas.map((l, k) => (k === i ? { ...l, ...c } : l)));
  const quitar = (i: number) => onCambiar(lecturas.length <= 1 ? [lecturaVacia()] : lecturas.filter((_, k) => k !== i));

  return (
    <section className="tarjeta tarjeta-ancha" id="seccion-temperaturas" aria-labelledby="sec3" data-testid="seccion-temperaturas">
      <h2 id="sec3" className="titulo-seccion"><Icono nombre="termometro" />3. Temperaturas del producto (°C)</h2>
      <p className="texto-suave">
        Temperatura de referencia de algunas gavetas. Elige la gaveta y escribe la temperatura; usa <strong>±</strong> para temperaturas bajo cero.
        Si necesitas más gavetas, presiona <strong>+ Agregar gaveta</strong>.
      </p>
      {conPeso.length === 0 && <p className="aviso-campo aviso-nuevo">Primero escribe el peso de las gavetas en la sección 2; aparecerán aquí para elegirlas.</p>}
      <div className="filas-temperatura">
        {lecturas.map((l, i) => {
          const err = errores.filas?.lecturas[i];
          const sinPeso = l.num_gaveta !== null && !conPeso.includes(l.num_gaveta);
          return (
            <div className="lectura" key={i} data-testid={`lectura-${i + 1}`}>
              <p className="lectura-titulo">Temperatura {i + 1}</p>
              <div className="rejilla-lectura">
                <div className="campo campo-compacto">
                  <label htmlFor={`lectura-${i + 1}-gaveta`}>N.º de gaveta</label>
                  <select id={`lectura-${i + 1}-gaveta`} value={l.num_gaveta ?? ''} aria-invalid={Boolean(err?.num_gaveta)}
                          aria-describedby={err?.num_gaveta ? `lectura-${i + 1}-gaveta-error` : undefined}
                          onChange={(e) => cambiar(i, { num_gaveta: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">Elige la gaveta…</option>
                    {sinPeso && <option value={l.num_gaveta!}>Gaveta {l.num_gaveta} (sin peso)</option>}
                    {conPeso.map((n) => <option key={n} value={n}>Gaveta {n} ({texto(gavetas[n - 1])})</option>)}
                  </select>
                  {err?.num_gaveta && <p className="error-campo" id={`lectura-${i + 1}-gaveta-error`}>{err.num_gaveta}</p>}
                </div>
                <TemperaturaInput id={`lectura-${i + 1}-temp`} etiqueta="Temperatura" value={l.temperatura_c}
                                  onChange={(v) => cambiar(i, { temperatura_c: v })} error={err?.temperatura_c} />
              </div>
              <button type="button" className="boton-enlace" onClick={() => quitar(i)} aria-label={`Quitar la fila de temperatura ${i + 1}`}>Quitar esta fila</button>
            </div>
          );
        })}
      </div>
      <div className="acciones-fila">
        <button type="button" className="boton-secundario" onClick={() => onCambiar([...lecturas, lecturaVacia()])} disabled={lecturas.length >= MAX_LECTURAS}>+ Agregar gaveta</button>
      </div>
    </section>
  );
}
