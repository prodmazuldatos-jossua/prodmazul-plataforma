import { useState } from 'react';
import { Icono } from '../../core/iconos';
import { descargarImagenBin, type DatosBin } from './qrBin';

interface Props { datos: DatosBin; numBin: string; deshabilitado?: boolean }

/** Botón que genera y descarga la imagen con el QR de un bin. No se genera nada hasta que se presiona. */
export default function BotonQrBin({ datos, numBin, deshabilitado }: Props) {
  const [estado, setEstado] = useState<'libre' | 'generando' | 'listo' | 'error'>('libre');
  const clic = async () => {
    setEstado('generando');
    try { await descargarImagenBin(datos, numBin); setEstado('listo'); }
    catch { setEstado('error'); }
  };
  return (
    <span className="qr-bin">
      <button type="button" className="boton-secundario boton-pequeno" disabled={deshabilitado || estado === 'generando'} onClick={() => void clic()}
              aria-label={`Descargar la imagen con el código QR del bin ${numBin || ''}`.trim()} data-testid={`boton-qr-${numBin}`}>
        <Icono nombre="qr" tamano={18} />{estado === 'generando' ? 'Generando…' : 'QR'}
      </button>
      {estado === 'listo' && <span className="texto-suave" role="status"> Descargado</span>}
      {estado === 'error' && <span className="error-campo" role="alert"> No se pudo generar</span>}
    </span>
  );
}
