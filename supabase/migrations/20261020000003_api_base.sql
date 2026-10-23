-- Prodmazul · Fase 4 · Parte 1 · Migración 4: API base (perfil y configuración)
-- La aplicación solo puede llamar a funciones api_*. Cada una valida permisos en la base de datos.
-- Los errores de negocio tienen el formato 'CODIGO|Mensaje en español'.

create function public.api_mi_perfil() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_p    core.perfiles;
  v_mods jsonb;
begin
  select * into v_p from core.perfiles where user_id = auth.uid();
  if not found or not v_p.activo then
    return jsonb_build_object('activo', false);
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'modulo_id', m.modulo_id,
             'nombre', m.nombre,
             'ruta', m.ruta,
             'rol_id', case when v_p.es_admin_general then 'admin_general' else u.rol_id end,
             'permisos', case
               when v_p.es_admin_general
                 then (select coalesce(jsonb_agg(permiso_id order by permiso_id), '[]'::jsonb) from core.permisos)
               else (select coalesce(jsonb_agg(rp.permiso_id order by rp.permiso_id), '[]'::jsonb)
                     from core.rol_permisos rp where rp.rol_id = u.rol_id)
             end)
           order by m.orden), '[]'::jsonb)
    into v_mods
  from core.modulos m
  left join core.usuario_modulo_rol u on u.modulo_id = m.modulo_id and u.user_id = v_p.user_id
  where m.habilitado and (v_p.es_admin_general or u.user_id is not null);

  return jsonb_build_object(
    'activo', true, 'user_id', v_p.user_id, 'nombre', v_p.nombre, 'correo', v_p.correo,
    'es_admin_general', v_p.es_admin_general, 'modulos', v_mods);
end $$;

create function public.api_config_publica() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not core.usuario_activo() then
    raise exception 'E_PERMISO|Tu cuenta no está activa.';
  end if;
  return (select coalesce(jsonb_object_agg(clave, valor), '{}'::jsonb)
          from core.config
          where clave in ('factor_lb_kg', 'formato_lote', 'max_fotos_recepcion', 'formulario_m01'));
end $$;

-- Solo usuarios con sesión (authenticated) pueden ejecutar las funciones api_*.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'api\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;
