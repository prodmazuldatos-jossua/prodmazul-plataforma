import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alerta, Cargando, Vacio } from '../../core/ui';
import { cola } from '../../offline/pendientes';
import type { Pendiente } from '../../offline/db';
import FormularioRecepcion from './FormularioRecepcion';

/** Abre una recepción rechazada para corregirla con el mismo formulario. */
export default function CorregirPendiente() {
  const { uuid = '' } = useParams();
  const [p, setP] = useState<Pendiente | null | undefined>(undefined);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    cola.obtener(uuid).then((x) => setP(x ?? null)).catch(() => { setFallo(true); setP(null); });
  }, [uuid]);
  if (p === undefined) return <Cargando texto="Abriendo la recepción pendiente…" />;
  if (fallo) return <Alerta tipo="error">No se pudo leer lo guardado en este dispositivo.</Alerta>;
  if (p === null || p.recepcion_id) {
    return <Vacio titulo="Ese pendiente ya no existe o no se puede corregir"><p><Link to="/m01/pendientes">Volver a pendientes</Link></p></Vacio>;
  }
  return <FormularioRecepcion pendiente={p} />;
}
