-- Prodmazul · Fase 4 · Parte 12 · Revisión de seguridad de la base de datos
-- Solo LEE: no cambia ni guarda nada. Se ejecuta en Supabase > SQL Editor > New query > Run.
-- Resultado: una tabla. Todas las filas deben decir CORRECTO. Las de tipo INFO solo informan.

with
tablas as (
  select c.oid, n.nspname as esquema, c.relname as tabla, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('core', 'm01_recepcion', 'public')
),
funciones as (
  select p.oid, n.nspname as esquema, p.proname as nombre, p.prosecdef as definer, p.proconfig as config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('core', 'm01_recepcion', 'public')
    and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
revision as (
  select 'S01' as id, 'Todas las tablas de core y m01_recepcion tienen RLS activado' as comprobacion,
    coalesce((select count(*) from tablas where esquema in ('core', 'm01_recepcion') and not rls), 0) = 0 as ok,
    coalesce((select string_agg(esquema || '.' || tabla, ', ') from tablas where esquema in ('core', 'm01_recepcion') and not rls), (select count(*) || ' tablas revisadas' from tablas where esquema in ('core', 'm01_recepcion'))) as detalle
  union all
  select 'S02', 'Ninguna tabla del esquema public queda expuesta sin RLS',
    coalesce((select count(*) from tablas where esquema = 'public' and not rls), 0) = 0,
    coalesce((select string_agg(tabla, ', ') from tablas where esquema = 'public' and not rls), (select count(*) || ' tablas en public' from tablas where esquema = 'public'))
  union all
  select 'S03', 'Los usuarios de la aplicación (anon y authenticated) no tienen permisos directos sobre ninguna tabla',
    coalesce((select count(*) from tablas where has_table_privilege('anon', oid, 'select,insert,update,delete,truncate,references,trigger')
                                           or has_table_privilege('authenticated', oid, 'select,insert,update,delete,truncate,references,trigger')), 0) = 0,
    coalesce((select string_agg(esquema || '.' || tabla, ', ') from tablas where has_table_privilege('anon', oid, 'select,insert,update,delete,truncate,references,trigger')
                                           or has_table_privilege('authenticated', oid, 'select,insert,update,delete,truncate,references,trigger')), 'sin permisos directos')
  union all
  select 'S04', 'anon y authenticated no pueden entrar a los esquemas core ni m01_recepcion',
    not exists (select 1 from pg_namespace n where n.nspname in ('core', 'm01_recepcion')
                and (has_schema_privilege('anon', n.oid, 'usage') or has_schema_privilege('authenticated', n.oid, 'usage'))),
    'esquemas internos cerrados'
  union all
  select 'S05', 'El acceso anónimo no puede ejecutar ninguna función (core, m01_recepcion y public)',
    coalesce((select count(*) from funciones where has_function_privilege('anon', oid, 'execute')), 0) = 0,
    coalesce((select string_agg(esquema || '.' || nombre, ', ') from funciones where has_function_privilege('anon', oid, 'execute')), (select count(*) || ' funciones revisadas' from funciones))
  union all
  select 'S06', 'Las funciones internas (core y m01_recepcion) no son ejecutables por authenticated: solo por medio de las api_',
    coalesce((select count(*) from funciones where esquema in ('core', 'm01_recepcion') and has_function_privilege('authenticated', oid, 'execute')), 0) = 0,
    coalesce((select string_agg(esquema || '.' || nombre, ', ') from funciones where esquema in ('core', 'm01_recepcion') and has_function_privilege('authenticated', oid, 'execute')), 'solo las api_ son públicas')
  union all
  select 'S07', 'Todas las funciones api_ son SECURITY DEFINER con search_path fijo',
    coalesce((select count(*) from funciones where esquema = 'public' and nombre like 'api\_%'
              and (not definer or not exists (select 1 from unnest(coalesce(config, '{}')) c where c like 'search_path=%'))), 0) = 0,
    coalesce((select string_agg(nombre, ', ') from funciones where esquema = 'public' and nombre like 'api\_%'
              and (not definer or not exists (select 1 from unnest(coalesce(config, '{}')) c where c like 'search_path=%'))),
             (select count(*) || ' funciones api_ revisadas' from funciones where esquema = 'public' and nombre like 'api\_%'))
  union all
  select 'S08', 'Las funciones de core y m01_recepcion que son SECURITY DEFINER tienen search_path fijo',
    coalesce((select count(*) from funciones where esquema in ('core', 'm01_recepcion') and definer
              and not exists (select 1 from unnest(coalesce(config, '{}')) c where c like 'search_path=%')), 0) = 0,
    coalesce((select string_agg(esquema || '.' || nombre, ', ') from funciones where esquema in ('core', 'm01_recepcion') and definer
              and not exists (select 1 from unnest(coalesce(config, '{}')) c where c like 'search_path=%')), 'search_path fijo')
  union all
  select 'S09', 'La auditoría solo se escribe por funciones: nadie puede modificarla directamente',
    not exists (select 1 from tablas where esquema = 'core' and tabla = 'auditoria'
                and (has_table_privilege('anon', oid, 'insert,update,delete') or has_table_privilege('authenticated', oid, 'insert,update,delete'))),
    'core.auditoria protegida'
  union all
  select 'S10', 'El bucket de fotos existe y es PRIVADO',
    coalesce((select not public from storage.buckets where id = 'm01-recepcion-fotos'), false),
    coalesce((select case when public then 'ES PÚBLICO' else 'privado' end from storage.buckets where id = 'm01-recepcion-fotos'), 'el bucket no existe')
  union all
  select 'S11', 'Las políticas de storage.objects no incluyen acceso anónimo ni público',
    coalesce((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and ('anon' = any(roles) or 'public' = any(roles))), 0) = 0,
    coalesce((select string_agg(policyname, ', ') from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and ('anon' = any(roles) or 'public' = any(roles))), (select count(*) || ' políticas, todas para authenticated' from pg_policies where schemaname = 'storage' and tablename = 'objects'))
  union all
  select 'S12', 'Las políticas de fotos existen (subir, ver y borrar)',
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('m01_fotos_subir', 'm01_fotos_ver', 'm01_fotos_borrar')) = 3,
    (select count(*) || ' de 3 políticas' from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('m01_fotos_subir', 'm01_fotos_ver', 'm01_fotos_borrar'))
  union all
  select 'S13', 'Existe al menos un administrador general activo',
    exists (select 1 from core.perfiles where es_admin_general and activo),
    (select count(*) || ' administrador(es) general(es) activo(s)' from core.perfiles where es_admin_general and activo)
)
select id, comprobacion, case when ok then 'CORRECTO' else 'FALLA' end as resultado, detalle
from revision
union all
select 'INFO-1', 'Usuarios activos / inactivos', 'INFO',
  (select count(*) filter (where activo) || ' activos, ' || count(*) filter (where not activo) || ' inactivos' from core.perfiles)
union all
select 'INFO-2', 'Usuarios con contraseña pero sin perfil (no podrían entrar)', 'INFO',
  (select count(*) || '' from auth.users u where not exists (select 1 from core.perfiles p where p.user_id = u.id))
order by id;
