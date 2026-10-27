// Permite importar index.ts en Node: «npm:@supabase/supabase-js@2» se reemplaza por un doble de prueba.
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('npm:@supabase/supabase-js')) return { url: new URL('./supabase_doble.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
