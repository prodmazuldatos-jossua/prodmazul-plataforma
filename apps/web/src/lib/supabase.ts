import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configuracionCompleta = Boolean(url && key && !url.includes('TU_PROJECT_REF'));

// La clave pública es visible en el navegador por diseño: lo que protege los datos
// son las reglas de la base de datos (funciones api_* y políticas de almacenamiento).
export const supabase = createClient(url ?? 'https://sin-configurar.invalid', key ?? 'sin-configurar', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
