import type { Seccion } from './esquema';

const SECCIONES: { id: Seccion; destino: string; texto: string }[] = [
  { id: 'datos', destino: 'sec1', texto: '1 Datos' },
  { id: 'gavetas', destino: 'seccion-gavetas', texto: '2 Gavetas' },
  { id: 'temperaturas', destino: 'seccion-temperaturas', texto: '3 Temperaturas' },
  { id: 'almacenamiento', destino: 'seccion-almacenamiento', texto: '4 Almacenamiento' },
  { id: 'cierre', destino: 'sec5', texto: '5 Cierre' },
];

/** Navegación fija entre secciones; marca con un número rojo las secciones que tienen errores. */
export default function NavSecciones({ errores }: { errores: Record<Seccion, number> }) {
  const ir = (destino: string) => document.getElementById(destino)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <nav className="nav-secciones" aria-label="Secciones del formulario">
      {SECCIONES.map((s) => (
        <button type="button" key={s.id} className="chip" onClick={() => ir(s.destino)} data-testid={`nav-${s.id}`}>
          {s.texto}
          {errores[s.id] > 0 && <span className="insignia-error" aria-label={`${errores[s.id]} errores`}>{errores[s.id]}</span>}
        </button>
      ))}
    </nav>
  );
}
