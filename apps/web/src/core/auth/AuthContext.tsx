import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { aApiError } from '../../lib/errores';
import { contarPendientes } from '../../offline/pendientes';

export interface ModuloAcceso { modulo_id: string; nombre: string; ruta: string; rol_id: string; permisos: string[] }
export interface Perfil {
  activo: boolean; user_id?: string; nombre?: string; correo?: string; es_admin_general?: boolean; modulos: ModuloAcceso[];
}

interface Ctx {
  session: Session | null;
  perfil: Perfil | null;
  cargando: boolean;
  puede: (modulo: string, permiso: string) => boolean;
  iniciarSesion: (correo: string, clave: string) => Promise<void>;
  cerrarSesion: () => Promise<void>;
  cambiarClave: (actual: string, nueva: string) => Promise<void>;
}

const AuthContext = createContext<Ctx | null>(null);
const CLAVE_PERFIL = 'prodmazul_perfil';
export const INACTIVIDAD_MS = 30 * 60 * 1000;
export const CLAVE_MINIMA = 10;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargarPerfil = useCallback(async (s: Session | null) => {
    if (!s) { setPerfil(null); return; }
    try {
      const { data, error } = await supabase.rpc('api_mi_perfil');
      if (error) throw error;
      const p = data as Perfil;
      setPerfil(p);
      try { localStorage.setItem(CLAVE_PERFIL, JSON.stringify({ uid: s.user.id, p })); } catch { /* sin almacenamiento */ }
    } catch (e) {
      // Sin conexión: se usa el último perfil conocido de esta misma persona.
      if (aApiError(e).codigo === 'E_RED') {
        try {
          const g = JSON.parse(localStorage.getItem(CLAVE_PERFIL) ?? 'null') as { uid: string; p: Perfil } | null;
          if (g && g.uid === s.user.id) { setPerfil(g.p); return; }
        } catch { /* ignorar */ }
      }
      setPerfil({ activo: false, modulos: [] });
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return;
      setSession(data.session);
      await cargarPerfil(data.session);
      if (vivo) setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => {
      setSession(s);
      // Se difiere para no bloquear el cliente de autenticación dentro de su propio evento.
      setTimeout(() => { void cargarPerfil(s); }, 0);
    });
    return () => { vivo = false; sub.subscription.unsubscribe(); };
  }, [cargarPerfil]);

  // Cierre de sesión por inactividad (no se cierra si hay registros pendientes de envío).
  const ultimaActividad = useRef(Date.now());
  useEffect(() => {
    if (!session) return;
    ultimaActividad.current = Date.now();
    const marcar = () => { ultimaActividad.current = Date.now(); };
    const eventos = ['pointerdown', 'keydown', 'touchstart'] as const;
    eventos.forEach((e) => window.addEventListener(e, marcar, { passive: true }));
    const t = setInterval(async () => {
      if (Date.now() - ultimaActividad.current > INACTIVIDAD_MS && (await contarPendientes()) === 0) {
        await supabase.auth.signOut();
      }
    }, 30_000);
    return () => { eventos.forEach((e) => window.removeEventListener(e, marcar)); clearInterval(t); };
  }, [session]);

  const puede = useCallback((modulo: string, permiso: string) =>
    Boolean(perfil?.activo && perfil.modulos.find((m) => m.modulo_id === modulo)?.permisos.includes(permiso)), [perfil]);

  const iniciarSesion = async (correo: string, clave: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: correo.trim(), password: clave });
    if (error) {
      if (/failed to fetch|network|load failed/i.test(error.message)) throw new Error('No hay conexión. Inténtalo cuando tengas señal.');
      throw new Error('Correo o contraseña incorrectos.');
    }
  };

  const cerrarSesion = async () => {
    if ((await contarPendientes()) > 0 &&
        !window.confirm('Hay registros guardados en este dispositivo que aún no se enviaron. Si cierras sesión ahora se enviarán cuando vuelvas a entrar. ¿Cerrar sesión?')) return;
    await supabase.auth.signOut();
    try { localStorage.removeItem(CLAVE_PERFIL); } catch { /* sin almacenamiento */ }
  };

  const cambiarClave = async (actual: string, nueva: string) => {
    const correo = session?.user.email;
    if (!correo) throw new Error('Tu sesión no es válida. Vuelve a iniciar sesión.');
    if (nueva.length < CLAVE_MINIMA) throw new Error(`La contraseña nueva debe tener al menos ${CLAVE_MINIMA} caracteres.`);
    if (nueva === actual) throw new Error('La contraseña nueva debe ser distinta de la actual.');
    const { error: e1 } = await supabase.auth.signInWithPassword({ email: correo, password: actual });
    if (e1) {
      if (/failed to fetch|network|load failed/i.test(e1.message)) throw new Error('No hay conexión. Inténtalo cuando tengas señal.');
      throw new Error('La contraseña actual no es correcta.');
    }
    const { error: e2 } = await supabase.auth.updateUser({ password: nueva });
    if (e2) {
      if (/failed to fetch|network|load failed/i.test(e2.message)) throw new Error('No hay conexión. Inténtalo cuando tengas señal.');
      throw new Error('No se pudo cambiar la contraseña. Prueba con una más larga o distinta.');
    }
  };

  return (
    <AuthContext.Provider value={{ session, perfil, cargando, puede, iniciarSesion, cerrarSesion, cambiarClave }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): Ctx {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return c;
}
