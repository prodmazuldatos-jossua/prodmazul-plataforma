import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthContext';
import { Cargando, Vacio } from '../../core/ui';
import { mensajeDe } from '../../lib/errores';
import { obtenerRecepcion } from './api';
import FormularioRecepcion from './FormularioRecepcion';
import { capacidades } from './mapeo';
import type { RecepcionDetalle } from './tipos';

/** Carga la recepción y abre el formulario para editarla (solo borradores y cerradas, y solo quien tiene derecho). */
export default function EdicionRecepcion() {
  const { id = '' } = useParams();
  const { perfil, puede } = useAuth();
  const [r, setR] = useState<RecepcionDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [recarga, setRecarga] = useState(0);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try { setR(await obtenerRecepcion(id)); } catch (e) { setR(null); setError(mensajeDe(e)); } finally { setCargando(false); }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (cargando) return <Cargando texto="Cargando la recepción…" />;
  if (error || !r) {
    return (
      <Vacio titulo="No se pudo abrir la recepción">
        <p>{error ?? 'La recepción no existe.'}</p>
        <Link className="boton-primario enlace-boton" to="/m01">Volver al listado</Link>
      </Vacio>
    );
  }
  const cap = capacidades(r, perfil?.user_id, (p) => puede('M01', p));
  if (!cap.editar) {
    return (
      <Vacio titulo="No puedes editar esta recepción">
        <p>{r.estado === 'anulado' || r.estado === 'eliminado'
          ? 'Una recepción anulada o eliminada no se edita. Un administrador puede reactivarla.'
          : 'Solo quien la creó, o un administrador, puede editarla.'}</p>
        <Link className="boton-primario enlace-boton" to={`/m01/${r.recepcion_id}`}>Ver la recepción</Link>
      </Vacio>
    );
  }
  return (
    <FormularioRecepcion key={`${r.recepcion_id}-${r.version}-${recarga}`} inicial={r}
                         onRecargar={() => { setRecarga((n) => n + 1); void cargar(); }} />
  );
}
