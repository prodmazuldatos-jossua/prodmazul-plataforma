-- Migración 22: Catálogo — eliminar y renombrar proveedores y especies (reemplaza «Unir» en la pantalla).
--  * api_admin_catalogo: ahora informa «en_uso» (tiene alguna recepción, de cualquier estado, o algún lote).
--  * api_admin_catalogo_renombrar: cambia el nombre sin duplicar otro nombre ni un alias.
--  * api_admin_catalogo_eliminar: solo si no está atado a ninguna recepción ni lote.
-- api_admin_catalogo_unir se conserva en la base de datos pero la aplicación ya no la usa.

create or replace function public.api_admin_catalogo(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tipo text := coalesce(nullif(btrim(p ->> 'tipo'), ''), 'proveedores');
  v_bus  text := nullif(btrim(coalesce(p ->> 'busqueda', '')), '');
  v_solo boolean := coalesce(p ->> 'solo_parecidos', 'false') in ('true', 't', '1');
  v_res  jsonb;
begin
  perform core.exigir_admin();
  p := coalesce(p, '{}'::jsonb);
  if v_tipo not in ('proveedores', 'especies') then
    raise exception 'E_VALIDACION|El catálogo debe ser proveedores o especies.';
  end if;
  if v_tipo = 'proveedores' then
    select jsonb_build_object('tipo', v_tipo,
             'total', (select count(*) from core.proveedores),
             'items', coalesce(jsonb_agg(jsonb_build_object(
                 'id', t.id, 'nombre', t.nombre, 'activo', t.activo, 'recepciones', t.recepciones, 'lotes', t.lotes,
                 'ultima_recepcion', t.ultima, 'en_uso', t.en_uso, 'parecidos', t.parecidos, 'grupo', case when t.parecidos > 1 then t.clave end)
               order by t.clave, t.nombre), '[]'::jsonb))
    into v_res
    from (
      select * from (
        select x.*, count(*) over (partition by x.clave) as parecidos
        from (
          select p0.id, p0.nombre, p0.activo, core.clave_parecida(p0.nombre) as clave,
                 (select count(*) from m01_recepcion.recepciones r where r.proveedor_id = p0.id and r.estado <> 'eliminado') as recepciones,
                 (select count(*) from core.lotes l where l.proveedor_id = p0.id) as lotes,
                 (select max(r.fecha_llegada) from m01_recepcion.recepciones r where r.proveedor_id = p0.id and r.estado <> 'eliminado') as ultima,
                 (exists (select 1 from m01_recepcion.recepciones r where r.proveedor_id = p0.id) or exists (select 1 from core.lotes l where l.proveedor_id = p0.id)) as en_uso
          from core.proveedores p0) x) y
      where (v_bus is null or y.nombre ilike '%' || v_bus || '%')
        and (not v_solo or y.parecidos > 1)
      order by y.clave, y.nombre
      limit 500) t;
  else
    select jsonb_build_object('tipo', v_tipo,
             'total', (select count(*) from core.especies),
             'items', coalesce(jsonb_agg(jsonb_build_object(
                 'id', t.id, 'nombre', t.nombre, 'activo', t.activo, 'recepciones', t.recepciones, 'lotes', t.lotes,
                 'ultima_recepcion', t.ultima, 'en_uso', t.en_uso, 'parecidos', t.parecidos, 'grupo', case when t.parecidos > 1 then t.clave end)
               order by t.clave, t.nombre), '[]'::jsonb))
    into v_res
    from (
      select * from (
        select x.*, count(*) over (partition by x.clave) as parecidos
        from (
          select p0.id, p0.nombre, p0.activo, core.clave_parecida(p0.nombre) as clave,
                 (select count(*) from m01_recepcion.recepciones r where r.especie_id = p0.id and r.estado <> 'eliminado') as recepciones,
                 (select count(*) from core.lotes l where l.especie_id = p0.id) as lotes,
                 (select max(r.fecha_llegada) from m01_recepcion.recepciones r where r.especie_id = p0.id and r.estado <> 'eliminado') as ultima,
                 (exists (select 1 from m01_recepcion.recepciones r where r.especie_id = p0.id) or exists (select 1 from core.lotes l where l.especie_id = p0.id)) as en_uso
          from core.especies p0) x) y
      where (v_bus is null or y.nombre ilike '%' || v_bus || '%')
        and (not v_solo or y.parecidos > 1)
      order by y.clave, y.nombre
      limit 500) t;
  end if;
  return v_res;
end $$;


create function public.api_admin_catalogo_renombrar(p_tipo text, p_id uuid, p_nombre text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tipo   text := btrim(coalesce(p_tipo, ''));
  v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_norm   text;
  v_k      text;
  v_antes  text;
  v_otro   text;
begin
  perform core.exigir_admin();
  if v_tipo not in ('proveedores', 'especies') then
    raise exception 'E_VALIDACION|El catálogo debe ser proveedores o especies.';
  end if;
  v_k := case v_tipo when 'proveedores' then 'proveedor' else 'especie' end;
  if p_id is null then raise exception 'E_VALIDACION|Falta elegir el nombre.'; end if;
  if char_length(v_nombre) < 2 then raise exception 'E_VALIDACION|El nombre debe tener al menos 2 caracteres.'; end if;
  if char_length(v_nombre) > 120 then raise exception 'E_VALIDACION|El nombre no puede superar los 120 caracteres.'; end if;
  v_norm := core.normalizar(v_nombre);
  if v_norm = '' then raise exception 'E_VALIDACION|El nombre no es válido.'; end if;

  if v_tipo = 'proveedores' then
    select nombre into v_antes from core.proveedores where id = p_id for update;
    if v_antes is null then raise exception 'E_NO_ENCONTRADO|Ese nombre ya no existe.'; end if;
    select nombre into v_otro from core.proveedores where nombre_normalizado = v_norm and id <> p_id;
  else
    select nombre into v_antes from core.especies where id = p_id for update;
    if v_antes is null then raise exception 'E_NO_ENCONTRADO|Ese nombre ya no existe.'; end if;
    select nombre into v_otro from core.especies where nombre_normalizado = v_norm and id <> p_id;
  end if;
  if v_otro is not null then
    raise exception 'E_DUPLICADO|Ya existe %: «%».', case v_tipo when 'proveedores' then 'otro proveedor' else 'otra especie' end, v_otro;
  end if;
  if exists (select 1 from core.catalogo_alias a where a.tipo = v_k and a.nombre_normalizado = v_norm and a.destino_id <> p_id) then
    raise exception 'E_DUPLICADO|Ese nombre ya fue unido a otro registro. Usa otro nombre.';
  end if;
  if v_antes = v_nombre then
    return jsonb_build_object('id', p_id, 'nombre', v_nombre, 'sin_cambios', true);
  end if;

  if v_tipo = 'proveedores' then
    update core.proveedores set nombre = v_nombre, nombre_normalizado = v_norm where id = p_id;
  else
    update core.especies set nombre = v_nombre, nombre_normalizado = v_norm where id = p_id;
  end if;
  perform core.auditar('M01', 'renombrar_' || v_k, v_k, p_id::text, jsonb_build_object('antes', v_antes, 'despues', v_nombre));
  return jsonb_build_object('id', p_id, 'nombre', v_nombre, 'antes', v_antes);
end $$;

create function public.api_admin_catalogo_eliminar(p_tipo text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tipo   text := btrim(coalesce(p_tipo, ''));
  v_k      text;
  v_nombre text;
  v_uso    boolean;
begin
  perform core.exigir_admin();
  if v_tipo not in ('proveedores', 'especies') then
    raise exception 'E_VALIDACION|El catálogo debe ser proveedores o especies.';
  end if;
  v_k := case v_tipo when 'proveedores' then 'proveedor' else 'especie' end;
  if p_id is null then raise exception 'E_VALIDACION|Falta elegir el nombre.'; end if;

  if v_tipo = 'proveedores' then
    select nombre into v_nombre from core.proveedores where id = p_id for update;
    if v_nombre is null then raise exception 'E_NO_ENCONTRADO|Ese nombre ya no existe.'; end if;
    v_uso := exists (select 1 from m01_recepcion.recepciones r where r.proveedor_id = p_id)
          or exists (select 1 from core.lotes l where l.proveedor_id = p_id);
  else
    select nombre into v_nombre from core.especies where id = p_id for update;
    if v_nombre is null then raise exception 'E_NO_ENCONTRADO|Ese nombre ya no existe.'; end if;
    v_uso := exists (select 1 from m01_recepcion.recepciones r where r.especie_id = p_id)
          or exists (select 1 from core.lotes l where l.especie_id = p_id);
  end if;
  if v_uso then
    raise exception 'E_EN_USO|No se puede eliminar «%»: está asociado a una o más recepciones.', v_nombre;
  end if;

  delete from core.catalogo_alias where tipo = v_k and destino_id = p_id;
  if v_tipo = 'proveedores' then delete from core.proveedores where id = p_id;
  else delete from core.especies where id = p_id; end if;
  perform core.auditar('M01', 'eliminar_' || v_k, v_k, p_id::text, jsonb_build_object('nombre', v_nombre));
  return jsonb_build_object('id', p_id, 'nombre', v_nombre, 'tipo', v_tipo);
end $$;

revoke all on function public.api_admin_catalogo_renombrar(text, uuid, text) from public, anon, authenticated;
revoke all on function public.api_admin_catalogo_eliminar(text, uuid) from public, anon, authenticated;
grant execute on function public.api_admin_catalogo_renombrar(text, uuid, text) to authenticated;
grant execute on function public.api_admin_catalogo_eliminar(text, uuid) to authenticated;
