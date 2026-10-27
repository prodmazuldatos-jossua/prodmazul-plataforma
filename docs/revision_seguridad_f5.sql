-- Prodmazul · Fase 5 · Parte 11 · Revisión de seguridad ampliada (SOLO LECTURA)
-- Cómo usarla: Supabase > SQL Editor > New query > pega TODO este archivo > Run.
-- No cambia nada y NO muestra valores de secretos: solo nombres, conteos y estados.
-- RESULTADO: una tabla con una fila por comprobación. Columna «estado»: OK, REVISAR o CRITICO.
-- Meta de la Fase 5: ninguna fila en CRITICO.

with
tablas as (
  select n.nspname as esquema, c.relname as tabla, c.relrowsecurity as rls,
         (select count(*) from pg_policy p where p.polrelid = c.oid) as politicas
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and n.nspname in ('core','m01_recepcion')
),
fn_api as (
  select p.oid, p.proname, p.prosecdef, p.proconfig,
         has_function_privilege('anon', p.oid, 'execute') as anon_ejecuta,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_ejecuta
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'api\_%'
),
fn_def as (
  select n.nspname, p.proname, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('core','m01_recepcion','public') and p.prosecdef
),
chequeos(orden, area, comprobacion, estado, detalle) as (
  select 1, 'Datos', 'Tablas de core y m01_recepcion con RLS activado',
    case when count(*) filter (where not rls) = 0 and count(*) > 0 then 'OK' else 'CRITICO' end,
    count(*) filter (where rls) || ' de ' || count(*) || ' con RLS' ||
    coalesce(' · sin RLS: ' || string_agg(esquema||'.'||tabla, ', ') filter (where not rls), '')
  from tablas
  union all
  select 2, 'Datos', 'Tablas sin políticas (el acceso es solo por funciones api_*)',
    case when count(*) filter (where politicas > 0) = 0 then 'OK' else 'REVISAR' end,
    coalesce('con políticas: ' || string_agg(esquema||'.'||tabla, ', ') filter (where politicas > 0), 'ninguna tabla tiene políticas')
  from tablas
  union all
  select 3, 'Datos', 'Los roles anon y authenticated no leen tablas directamente',
    case when count(*) = 0 then 'OK' else 'CRITICO' end,
    coalesce(string_agg(esquema||'.'||tabla, ', '), 'sin acceso directo')
  from (
    select t.esquema, t.tabla from tablas t
    where has_table_privilege('anon', format('%I.%I', t.esquema, t.tabla), 'select')
       or has_table_privilege('authenticated', format('%I.%I', t.esquema, t.tabla), 'select')
  ) x
  union all
  select 4, 'Funciones', 'Ninguna función public.api_* es ejecutable por anon',
    case when count(*) filter (where anon_ejecuta) = 0 and count(*) > 0 then 'OK' else 'CRITICO' end,
    count(*) || ' funciones api_*' || coalesce(' · expuestas a anon: ' || string_agg(proname, ', ') filter (where anon_ejecuta), '')
  from fn_api
  union all
  select 5, 'Funciones', 'Las funciones api_* las ejecuta authenticated',
    case when count(*) filter (where not auth_ejecuta) = 0 then 'OK' else 'REVISAR' end,
    coalesce('sin permiso: ' || string_agg(proname, ', ') filter (where not auth_ejecuta), 'todas con permiso')
  from fn_api
  union all
  select 6, 'Funciones', 'Funciones SECURITY DEFINER con search_path fijo',
    case when count(*) filter (where not coalesce(array_to_string(proconfig, ',') like '%search_path%', false)) = 0 then 'OK' else 'CRITICO' end,
    count(*) || ' funciones SECURITY DEFINER' ||
    coalesce(' · sin search_path: ' || string_agg(nspname||'.'||proname, ', ') filter (where not coalesce(array_to_string(proconfig, ',') like '%search_path%', false)), '')
  from fn_def
  union all
  select 7, 'Funciones', 'Funciones internas de core no ejecutables por anon ni authenticated',
    case when count(*) = 0 then 'OK' else 'REVISAR' end,
    coalesce(string_agg(proname, ', '), 'ninguna expuesta')
  from (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'core' and p.prosecdef
      and p.proname in ('sync_disparar','purga_disparar','sync_encolar_catalogos','secreto')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  ) y
)
select orden, area, comprobacion, estado, detalle from chequeos
union all
select 8, 'Almacenamiento', 'El bucket de fotos m01-recepcion-fotos es privado',
  case when to_regclass('storage.buckets') is null then 'REVISAR'
       else coalesce((select case when public then 'CRITICO' else 'OK' end from storage.buckets where id = 'm01-recepcion-fotos'), 'REVISAR') end,
  case when to_regclass('storage.buckets') is null then 'no existe el esquema storage aquí'
       else coalesce((select case when public then 'el bucket es PÚBLICO' else 'privado' end from storage.buckets where id = 'm01-recepcion-fotos'), 'no se encontró el bucket') end
union all
select 9, 'Secretos', 'Nombres de secretos en Vault (no se muestran valores)',
  case when to_regclass('vault.secrets') is null then 'REVISAR' else 'OK' end,
  case when to_regclass('vault.secrets') is null then 'Vault no está instalado aquí'
       else coalesce((select string_agg(name, ', ' order by name) from vault.secrets), 'sin secretos') end
union all
select 10, 'Programación', 'Tareas programadas (pg_cron): nombre y horario',
  case when to_regclass('cron.job') is null then 'REVISAR' else 'OK' end,
  case when to_regclass('cron.job') is null then 'pg_cron no está instalado aquí'
       else coalesce((select string_agg(jobname||' ['||schedule||']', ' · ' order by jobname) from cron.job where jobname like 'prodmazul-%'), 'ninguna tarea prodmazul-*') end
union all
select 11, 'Cuentas', 'Administradores generales activos',
  case when n between 1 and 3 then 'OK' else 'REVISAR' end,
  n || ' administrador(es) general(es) activo(s) (lo normal es 1 a 3)'
from (select count(*) as n from core.perfiles where es_admin_general and activo) a
union all
select 12, 'Cuentas', 'Cuentas activas sin ningún módulo asignado y sin ser administrador',
  case when n = 0 then 'OK' else 'REVISAR' end,
  n || ' cuenta(s)'
from (select count(*) as n from core.perfiles p where p.activo and not p.es_admin_general
      and not exists (select 1 from core.usuario_modulo_rol r where r.user_id = p.user_id)) b
union all
select 13, 'Configuración', 'Parámetros de purga y envío a Sheets',
  'OK',
  coalesce((select string_agg(clave||'='||valor::text, ' · ' order by clave) from core.config where clave in ('purga_activa','sync_activa')), 'sin datos')
order by 1;
