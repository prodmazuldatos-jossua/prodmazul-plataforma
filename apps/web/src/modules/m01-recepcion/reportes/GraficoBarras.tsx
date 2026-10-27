import { escalaEje, type DatosGrafico } from './reportes';

const ANCHO = 640;

/** Gráfico de barras en SVG. Lleva título y descripción para lectores de pantalla; los mismos datos están en la tabla de abajo. */
export default function GraficoBarras({ datos }: { datos: DatosGrafico }) {
  const { barras, horizontal } = datos;
  if (barras.length === 0) return null;
  const max = Math.max(...barras.map((b) => b.valor), 0);
  const eje = escalaEje(max);
  const resumen = barras.map((b) => `${b.etiqueta}: ${b.texto}`).join('; ');
  const desc = `${datos.titulo} (${datos.unidad}). ${resumen}.`;

  if (horizontal) {
    const fila = 30; const izq = 150; const der = 70; const arr = 8; const abajo = 28;
    const alto = arr + barras.length * fila + abajo;
    const util = ANCHO - izq - der;
    return (
      <figure className="grafico" data-testid="grafico">
        <figcaption>{datos.titulo} <span className="grafico-unidad">({datos.unidad})</span></figcaption>
        <svg viewBox={`0 0 ${ANCHO} ${alto}`} role="img" aria-labelledby="g-t g-d" preserveAspectRatio="xMidYMid meet">
          <title id="g-t">{datos.titulo}</title><desc id="g-d">{desc}</desc>
          {eje.valores.map((v) => {
            const x = izq + (v / eje.tope) * util;
            return <g key={v}><line x1={x} x2={x} y1={arr} y2={alto - abajo} className="g-guia" /><text x={x} y={alto - 10} textAnchor="middle" className="g-eje">{new Intl.NumberFormat('en-US').format(v)}</text></g>;
          })}
          {barras.map((b, i) => {
            const y = arr + i * fila + 5; const w = (b.valor / eje.tope) * util;
            const nombre = b.etiquetaCorta.length > 22 ? `${b.etiquetaCorta.slice(0, 21)}…` : b.etiquetaCorta;
            return (
              <g key={`${b.etiqueta}-${i}`}>
                <text x={izq - 8} y={y + 14} textAnchor="end" className="g-etq">{nombre}</text>
                <rect x={izq} y={y} width={Math.max(w, b.valor > 0 ? 2 : 0)} height={20} rx={3} className="g-barra"><title>{b.etiqueta}: {b.texto}</title></rect>
                <text x={izq + w + 6} y={y + 14} className="g-valor">{b.texto}</text>
              </g>
            );
          })}
        </svg>
        {datos.nota && <p className="grafico-nota">{datos.nota}</p>}
      </figure>
    );
  }

  const izq = 56; const der = 10; const arr = 14; const abajo = 46; const alto = 260;
  const util = ANCHO - izq - der; const hUtil = alto - arr - abajo;
  const paso = util / barras.length; const ancho = Math.min(46, paso * 0.7);
  const cada = Math.max(1, Math.ceil(barras.length / 12));
  return (
    <figure className="grafico" data-testid="grafico">
      <figcaption>{datos.titulo} <span className="grafico-unidad">({datos.unidad})</span></figcaption>
      <svg viewBox={`0 0 ${ANCHO} ${alto}`} role="img" aria-labelledby="g-t g-d" preserveAspectRatio="xMidYMid meet">
        <title id="g-t">{datos.titulo}</title><desc id="g-d">{desc}</desc>
        {eje.valores.map((v) => {
          const y = arr + hUtil - (v / eje.tope) * hUtil;
          return <g key={v}><line x1={izq} x2={ANCHO - der} y1={y} y2={y} className="g-guia" /><text x={izq - 6} y={y + 4} textAnchor="end" className="g-eje">{new Intl.NumberFormat('en-US').format(v)}</text></g>;
        })}
        {barras.map((b, i) => {
          const h = (b.valor / eje.tope) * hUtil; const x = izq + i * paso + (paso - ancho) / 2;
          return (
            <g key={`${b.etiqueta}-${i}`}>
              <rect x={x} y={arr + hUtil - h} width={ancho} height={Math.max(h, b.valor > 0 ? 2 : 0)} rx={3} className="g-barra"><title>{b.etiqueta}: {b.texto}</title></rect>
              {i % cada === 0 && <text x={x + ancho / 2} y={alto - abajo + 16} textAnchor="middle" className="g-etq">{b.etiquetaCorta}</text>}
            </g>
          );
        })}
      </svg>
      {datos.nota && <p className="grafico-nota">{datos.nota}</p>}
    </figure>
  );
}
