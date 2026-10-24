import { Link } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Vacio } from './ui';

export default function Inicio() {
  const { perfil } = useAuth();
  const modulos = perfil?.modulos ?? [];
  const nombre = perfil?.nombre?.trim();
  return (
    <>
      <h1>Hola{nombre ? `, ${nombre}` : ''}</h1>
      <p className="texto-suave">Estos son los módulos a los que tienes acceso.</p>
      {modulos.length === 0 ? (
        <Vacio titulo="Todavía no tienes módulos asignados">
          <p>Pide al administrador que te asigne un módulo.</p>
        </Vacio>
      ) : (
        <div className="rejilla-modulos">
          {modulos.map((m) => (
            <Link key={m.modulo_id} to={m.ruta} className="tarjeta-modulo">
              <span className="modulo-codigo">{m.modulo_id}</span>
              <span className="modulo-nombre">{m.nombre}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
