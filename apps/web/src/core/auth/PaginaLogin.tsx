import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Alerta } from '../ui';
import { configuracionCompleta } from '../../lib/supabase';

export default function PaginaLogin() {
  const { session, perfil, cargando, iniciarSesion, cerrarSesion } = useAuth();
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [ver, setVer] = useState(false);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (session && perfil?.activo) return <Navigate to="/" replace />;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setEnviando(true);
    try { await iniciarSesion(correo, clave); }
    catch (err) { setError((err as Error).message); }
    finally { setEnviando(false); }
  };

  return (
    <main className="pagina-acceso">
      <form className="tarjeta-acceso" onSubmit={enviar} noValidate>
        <img src="/logo.png" alt="Prodmazul S.A." className="logo-acceso" />
        <h1>Plataforma de Producción</h1>
        {!configuracionCompleta && (
          <Alerta tipo="error">Falta configurar la conexión con Supabase (archivo .env.local o variables de Cloudflare). Revisa la guía de implementación.</Alerta>
        )}
        {session && perfil && !perfil.activo && !cargando && (
          <Alerta tipo="error">
            Tu cuenta está desactivada o todavía no tiene acceso. Pide al administrador que la habilite.
            <button type="button" className="boton-enlace" onClick={cerrarSesion}>Salir</button>
          </Alerta>
        )}
        {error && <Alerta tipo="error">{error}</Alerta>}
        <div className="campo">
          <label htmlFor="correo">Correo</label>
          <input id="correo" type="email" autoComplete="username" required value={correo} onChange={(e) => setCorreo(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="clave">Contraseña</label>
          <div className="campo-con-boton">
            <input id="clave" type={ver ? 'text' : 'password'} autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} />
            <button type="button" className="boton-secundario" onClick={() => setVer(!ver)} aria-pressed={ver}>{ver ? 'Ocultar' : 'Ver'}</button>
          </div>
        </div>
        <button className="boton-primario boton-ancho" type="submit" disabled={enviando || !correo || !clave}>
          {enviando ? 'Ingresando…' : 'Iniciar sesión'}
        </button>
        <p className="texto-suave centrado">¿Olvidaste tu contraseña? Pide al administrador que la cambie.</p>
      </form>
    </main>
  );
}
