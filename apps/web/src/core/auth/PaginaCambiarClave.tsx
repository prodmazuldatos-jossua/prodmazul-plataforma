import { useState, type FormEvent } from 'react';
import { useAuth, CLAVE_MINIMA } from './AuthContext';
import { Alerta } from '../ui';

export default function PaginaCambiarClave() {
  const { cambiarClave } = useAuth();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repite, setRepite] = useState('');
  const [error, setError] = useState('');
  const [listo, setListo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setListo(false);
    if (nueva !== repite) { setError('Las contraseñas nuevas no coinciden.'); return; }
    setEnviando(true);
    try {
      await cambiarClave(actual, nueva);
      setListo(true); setActual(''); setNueva(''); setRepite('');
    } catch (err) { setError((err as Error).message); }
    finally { setEnviando(false); }
  };

  return (
    <>
      <h1>Cambiar mi contraseña</h1>
      <form className="formulario-estrecho" onSubmit={enviar}>
        {listo && <Alerta tipo="exito">Tu contraseña se cambió. Úsala la próxima vez que inicies sesión.</Alerta>}
        {error && <Alerta tipo="error">{error}</Alerta>}
        <div className="campo">
          <label htmlFor="actual">Contraseña actual</label>
          <input id="actual" type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="nueva">Contraseña nueva (mínimo {CLAVE_MINIMA} caracteres)</label>
          <input id="nueva" type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="repite">Repite la contraseña nueva</label>
          <input id="repite" type="password" autoComplete="new-password" value={repite} onChange={(e) => setRepite(e.target.value)} />
        </div>
        <button className="boton-primario" type="submit" disabled={enviando || !actual || !nueva || !repite}>
          {enviando ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </form>
    </>
  );
}
