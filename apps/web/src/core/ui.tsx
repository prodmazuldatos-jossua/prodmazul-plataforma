import { useEffect, useRef, type ReactNode } from 'react';

export function Alerta({ tipo = 'info', children }: { tipo?: 'info' | 'exito' | 'aviso' | 'error'; children: ReactNode }) {
  return <div className={`alerta alerta-${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <div className="cargando" role="status"><span className="giro" aria-hidden="true" />{texto}</div>;
}

export function Vacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return <div className="vacio"><p className="vacio-titulo">{titulo}</p>{children}</div>;
}

interface ModalProps { titulo: string; children: ReactNode; onCerrar: () => void; acciones?: ReactNode }

export function Modal({ titulo, children, onCerrar, acciones }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);
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
