import { Link } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Vacio } from './ui';
import { Icono, iconoDeModulo } from './iconos';
import { etiquetaModulo } from '../lib/texto';

export default function Inicio() {
  const { perfil, puede } = useAuth();
  const modulos = perfil?.modulos ?? [];
  const nombre = perfil?.nombre?.trim();
  const fecha = new Date().toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hoy = fecha.charAt(0).toUpperCase() + fecha.slice(1);
  const puedeCrear = puede('M01', 'crear');
  return (
    <>
      <section className="hero" aria-label="Bienvenida">
        <h1>Hola{nombre ? `, ${nombre}` : ''}</h1>
        <p>{hoy}</p>
        {puedeCrear && (
          <div className="accesos">
            <Link to="/m01/nueva" className="boton-secundario enlace-boton"><Icono nombre="mas" />Nueva recepción</Link>
            <Link to="/m01" className="boton-secundario enlace-boton"><Icono nombre="lista" />Ver recepciones</Link>
          </div>
        )}
      </section>
      <h2 className="subtitulo">Módulos</h2>
      <p className="texto-suave">Estos son los módulos a los que tienes acceso.</p>
      {modulos.length === 0 ? (
        <Vacio titulo="Todavía no tienes módulos asignados">
          <p>Pide al administrador que te asigne un módulo.</p>
        </Vacio>
      ) : (
        <div className="rejilla-modulos">
          {modulos.map((m) => (
            <Link key={m.modulo_id} to={m.ruta} className="tarjeta-modulo">
              <span className="modulo-texto">
                <span className="modulo-codigo">{etiquetaModulo(m.modulo_id)}</span>
                <span className="modulo-nombre">{m.nombre}</span>
                <span className="modulo-ir">Abrir <Icono nombre="derecha" tamano={16} /></span>
              </span>
              <span className="modulo-icono"><Icono nombre={iconoDeModulo(m.modulo_id)} tamano={38} /></span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
