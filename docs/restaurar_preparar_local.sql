-- Prodmazul · Fase 4 · Parte 12 · Prepara la base LOCAL para restaurar una copia (vacía los datos de la aplicación).
-- SOLO para la base LOCAL de pruebas (supabase start). NUNCA en el proyecto real de Supabase en internet.
do $$
declare t text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ') into t
  from pg_tables where schemaname in ('core', 'm01_recepcion');
  execute 'truncate table ' || t || ' restart identity cascade';
  truncate table auth.users cascade;
end $$;
