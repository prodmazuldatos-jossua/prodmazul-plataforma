import { useEffect, useRef, type ReactNode } from 'react';
import { Icono, type NombreIcono } from './iconos';

const ICONO_ALERTA: Record<string, NombreIcono> = { info: 'info', exito: 'ok', aviso: 'alerta', error: 'error' };

export function Alerta({ tipo = 'info', children }: { tipo?: 'info' | 'exito' | 'aviso' | 'error'; children: ReactNode }) {
  return (
    <div className={`alerta alerta-${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      <Icono nombre={ICONO_ALERTA[tipo]} tamano={22} />
      <div className="alerta-cuerpo">{children}</div>
    </div>
  );
}

/** Indicador de carga: giro + texto, y barras de esqueleto que dan la sensación de que la pantalla ya está lista. */
export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <>
      <div className="cargando" role="status"><span className="giro" aria-hidden="true" />{texto}</div>
      <div className="esqueleto" aria-hidden="true"><span /><span /><span /></div>
    </>
  );
}

export function Vacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return <div className="vacio"><p className="vacio-titulo">{titulo}</p>{children}</div>;
}

interface ModalProps { titulo: string; children: ReactNode; onCerrar: () => void; acciones?: ReactNode }

export function Modal({ titulo, children, onCerrar, acciones }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  // La función de cierre llega nueva en cada render (cada tecla escrita). Se guarda en una referencia para que el
  // efecto corra UNA sola vez: antes se repetía en cada tecla y devolvía el foco al cuadro, cortando la escritura.
  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar.current(); };
    window.addEventListener('keydown', tecla);
    return () => { window.removeEventListener('keydown', tecla); previo?.focus?.(); };
  }, []);
  return (
    <div className="modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1} ref={ref}>
        <h2>{titulo}</h2>
        <div>{children}</div>
        {acciones && <div className="modal-acciones">{acciones}</div>}
      </div>
    </div>
  );
}
