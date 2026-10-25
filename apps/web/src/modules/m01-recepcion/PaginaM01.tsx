import { Route, Routes } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthContext';
import { Vacio } from '../../core/ui';
import DetalleRecepcion from './DetalleRecepcion';
import EdicionRecepcion from './EdicionRecepcion';
import FormularioRecepcion from './FormularioRecepcion';
import ListadoRecepciones from './ListadoRecepciones';

function SoloCrear({ children }: { children: React.ReactNode }) {
  const { puede } = useAuth();
  if (!puede('M01', 'crear')) {
    return <Vacio titulo="Sin permiso"><p>Tu rol no permite registrar recepciones.</p></Vacio>;
  }
  return <>{children}</>;
}

function SoloVer({ children }: { children: React.ReactNode }) {
  const { puede } = useAuth();
  if (!puede('M01', 'ver')) {
    return <Vacio titulo="Sin permiso"><p>Tu rol no permite ver las recepciones.</p></Vacio>;
  }
  return <>{children}</>;
}

export default function PaginaM01() {
  return (
    <Routes>
      <Route index element={<SoloVer><ListadoRecepciones /></SoloVer>} />
      <Route path="nueva" element={<SoloCrear><FormularioRecepcion /></SoloCrear>} />
      <Route path=":id" element={<SoloVer><DetalleRecepcion /></SoloVer>} />
      <Route path=":id/editar" element={<SoloVer><EdicionRecepcion /></SoloVer>} />
      <Route path="*" element={<SoloVer><ListadoRecepciones /></SoloVer>} />
    </Routes>
  );
}
