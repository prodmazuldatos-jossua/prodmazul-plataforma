-- Fase 5 · Parte 9 · Administración de usuarios: auditoría con «antes y después» e historial.
-- No cambia ningún dato existente ni los permisos. NUNCA se guarda ni se devuelve una contraseña.

-- 1) Al actualizar un usuario, cada tipo de cambio queda como un evento propio, con el valor anterior y el nuevo.
create or replace function public.api_admin_actualizar_usuario(p_user uuid, p_nombre text, p_activo boolean, p_roles jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_p     core.perfiles;
  v_antes jsonb;
  v_desp  jsonb;
  v_r_a   jsonb;
  v_r_d   jsonb;
  v_nom   text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_n     integer := 0;
begin
  if not core.es_admin_general() then
    raise exception 'E_PERMISO|Solo el administrador general puede modificar usuarios.';
  end if;
  select * into v_p from core.perfiles where user_id = p_user;
  if not found then
    raise exception 'E_NO_ENCONTRADO|El usuario no existe.';
  end if;
  if v_p.es_admin_general and coalesce(p_activo, true) = false then
    raise exception 'E_ESTADO|No se puede desactivar a un administrador general.';
  end if;
  if v_p.es_admin_general and jsonb_array_length(coalesce(p_roles, '[]'::jsonb)) > 0 then
    raise exception 'E_ESTADO|Un administrador general ya tiene todos los permisos: no se le asignan roles.';
  end if;

  select coalesce(jsonb_object_agg(modulo_id, rol_id), '{}'::jsonb) into v_r_a from core.usuario_modulo_rol where user_id = p_user;
  perform core.aplicar_datos_usuario(p_user, p_nombre, p_activo, p_roles);
  select coalesce(jsonb_object_agg(modulo_id, rol_id), '{}'::jsonb) into v_r_d from core.usuario_modulo_rol where user_id = p_user;

  if v_p.nombre is distinct from v_nom then
    perform core.auditar('CORE', 'cambiar_nombre_usuario', 'usuario', p_user::text,
      jsonb_build_object('correo', v_p.correo, 'antes', v_p.nombre, 'despues', v_nom));
    v_n := v_n + 1;
  end if;
  if coalesce(p_activo, v_p.activo) is distinct from v_p.activo then
    perform core.auditar('CORE', case when coalesce(p_activo, v_p.activo) then 'reactivar_usuario' else 'desactivar_usuario' end, 'usuario', p_user::text,
      jsonb_build_object('correo', v_p.correo, 'antes', v_p.activo, 'despues', coalesce(p_activo, v_p.activo)));
    v_n := v_n + 1;
  end if;
  if v_r_a is distinct from v_r_d then
    perform core.auditar('CORE', 'cambiar_roles_usuario', 'usuario', p_user::text,
      jsonb_build_object('correo', v_p.correo, 'antes', v_r_a, 'despues', v_r_d));
    v_n := v_n + 1;
  end if;
  if v_n = 0 then
    perform core.auditar('CORE', 'actualizar_usuario', 'usuario', p_user::text, jsonb_build_object('correo', v_p.correo, 'sin_cambios', true));
  end if;
  return jsonb_build_object('user_id', p_user, 'ok', true, 'cambios', v_n);
end $$;

-- 2) El alta guarda también el correo en la auditoría (la contraseña nunca llega a la base de datos de la aplicación).
create or replace function public.adm_registrar_usuario(p_user uuid, p_nombre text, p_roles jsonb, p_admin uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_correo text;
begin
  perform core.aplicar_datos_usuario(p_user, p_nombre, true, p_roles);
  select correo into v_correo from core.perfiles where user_id = p_user;
  insert into core.auditoria (user_id, modulo_id, accion, entidad, entidad_id, detalle)
  values (p_admin, 'CORE', 'crear_usuario', 'usuario', p_user::text,
          jsonb_build_object('correo', v_correo, 'nombre', btrim(p_nombre), 'roles', coalesce(p_roles, '[]'::jsonb)));
  return jsonb_build_object('user_id', p_user, 'ok', true);
end $$;

create or replace function public.adm_auditar_clave(p_user uuid, p_admin uuid)
returns void
language sql security definer set search_path = '' as $$
  insert into core.auditoria (user_id, modulo_id, accion, entidad, entidad_id, detalle)
  values (p_admin, 'CORE', 'cambiar_clave_usuario', 'usuario', p_user::text,
          jsonb_build_object('correo', (select correo from core.perfiles where user_id = p_user)))
$$;

-- 3) Historial de cambios de usuarios (solo el administrador general). Devuelve los últimos eventos, del más nuevo al más antiguo.
create function public.api_admin_historial_usuarios(p_n integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_n integer := least(greatest(coalesce(p_n, 30), 1), 200);
begin
  if not core.es_admin_general() then
    raise exception 'E_PERMISO|Solo el administrador general puede ver el historial de usuarios.';
  end if;
  return jsonb_build_object('eventos', (
    select coalesce(jsonb_agg(e order by e.evento_id desc), '[]'::jsonb)
    from (
      select a.evento_id, a.creado_en, a.accion,
             coalesce(nullif(q.nombre, ''), q.correo) as quien,
             a.entidad_id as usuario_id,
             coalesce(nullif(u.nombre, ''), u.correo, a.detalle ->> 'correo') as usuario,
             coalesce(u.correo, a.detalle ->> 'correo') as usuario_correo,
             a.detalle - 'clave' - 'password' - 'contrasena' - 'contraseña' as detalle
      from core.auditoria a
      left join core.perfiles q on q.user_id = a.user_id
      left join core.perfiles u on u.user_id::text = a.entidad_id
      where a.modulo_id = 'CORE' and a.entidad = 'usuario'
        and a.accion in ('crear_usuario', 'actualizar_usuario', 'cambiar_nombre_usuario', 'cambiar_roles_usuario',
                         'desactivar_usuario', 'reactivar_usuario', 'cambiar_clave_usuario')
      order by a.evento_id desc
      limit v_n
    ) e));
end $$;

-- 4) Permisos: solo sesiones iniciadas (la función valida que sea administrador general).
revoke all on function public.api_admin_historial_usuarios(integer) from public, anon, authenticated;
grant execute on function public.api_admin_historial_usuarios(integer) to authenticated;
