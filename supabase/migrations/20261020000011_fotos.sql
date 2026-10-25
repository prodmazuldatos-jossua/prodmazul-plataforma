-- Prodmazul · Fase 4 · Parte 9 · Migración 11: fotos de la recepción
--
-- Qué hace:
--   1) Deja el bucket privado «m01-recepcion-fotos» (si no existía lo crea; si existía lo vuelve a dejar privado,
--      con límite de 5 MB y solo JPEG, PNG o WebP).
--   2) Funciones para registrar, confirmar, listar y eliminar fotos (máximo 5 por recepción, cupos reutilizables).
--      Identificador: FOT-M01-{lote}-{recepcion_id}-{nn}.
--   3) Políticas de almacenamiento: subir, ver y borrar SOLO lo que está registrado en fotos_meta y según el permiso.
--
-- Flujo de una foto nueva (lo hace la aplicación):
--   api_m01_registrar_foto  →  subir el archivo al bucket  →  api_m01_confirmar_foto
-- Un registro que nunca se confirma (la subida falló o se cortó) libera su cupo a la hora.
-- Para borrar: la aplicación borra el archivo del bucket y luego llama a api_m01_eliminar_foto.

-- ---------------------------------------------------------------- 1) bucket privado
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('m01-recepcion-fotos', 'm01-recepcion-fotos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- ---------------------------------------------------------------- 2) funciones
-- Registra una foto que se va a subir. Devuelve el identificador y la ruta donde debe subirse el archivo.
create function public.api_m01_registrar_foto(p_recepcion_id text, p_nombre text, p_tipo_mime text, p_tamano integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_r      m01_recepcion.recepciones;
  v_nn     integer;
  v_id     text;
  v_ext    text;
  v_ruta   text;
  v_nombre text := left(btrim(coalesce(p_nombre, '')), 120);
  v_max    integer;
begin
  perform core.exigir('M01', 'cargar_imagenes');
  select * into v_r from m01_recepcion.recepciones where recepcion_id = p_recepcion_id for update;
  if not found or (v_r.estado = 'eliminado' and not core.tiene_permiso('M01', 'eliminar')) then
    raise exception 'E_NO_ENCONTRADO|La recepción no existe.';
  end if;
  if v_r.estado not in ('borrador', 'cerrado') then
    raise exception 'E_ESTADO|No se pueden agregar fotos a una recepción anulada o eliminada.';
  end if;
  if v_r.creado_por is distinct from v_uid and not core.tiene_permiso('M01', 'eliminar') then
    raise exception 'E_PERMISO|Solo quien creó la recepción (o un administrador) puede agregarle fotos.';
  end if;
  if p_tipo_mime not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'E_VALIDACION|La foto debe ser JPEG, PNG o WebP.';
  end if;
  if p_tamano is null or p_tamano <= 0 or p_tamano > 5242880 then
    raise exception 'E_VALIDACION|La foto debe pesar más de 0 y como máximo 5 MB.';
  end if;
  if v_nombre = '' then v_nombre := 'foto'; end if;

  -- Los intentos de subida que nunca se confirmaron se liberan a la hora.
  delete from m01_recepcion.fotos_meta where not confirmada and subido_en < now() - interval '1 hour';

  -- Primer cupo libre (1 a 5). Si se borró una foto, su número se reutiliza.
  select min(n) into v_nn
  from generate_series(1, 5) n
  where not exists (select 1 from m01_recepcion.fotos_meta f where f.recepcion_id = p_recepcion_id and f.nn = n);
  select coalesce((valor #>> '{}')::integer, 5) into v_max from core.config where clave = 'max_fotos_recepcion';
  if v_nn is null or (select count(*) from m01_recepcion.fotos_meta where recepcion_id = p_recepcion_id) >= coalesce(v_max, 5) then
    raise exception 'E_FOTOS|Cada recepción admite como máximo % fotos.', coalesce(v_max, 5);
  end if;

  v_ext  := case p_tipo_mime when 'image/png' then 'png' when 'image/webp' then 'webp' else 'jpg' end;
  v_id   := 'FOT-M01-' || v_r.lote_id || '-' || p_recepcion_id || '-' || lpad(v_nn::text, 2, '0');
  v_ruta := 'M01/' || v_r.lote_id || '/' || p_recepcion_id || '/' || v_id || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6) || '.' || v_ext;

  insert into m01_recepcion.fotos_meta (foto_id, recepcion_id, lote_id, nn, ruta, nombre, tipo_mime, tamano_bytes, subido_por)
  values (v_id, p_recepcion_id, v_r.lote_id, v_nn, v_ruta, v_nombre, p_tipo_mime, p_tamano, v_uid);

  return jsonb_build_object('foto_id', v_id, 'nn', v_nn, 'ruta', v_ruta);
end $$;

-- Confirma que el archivo llegó al almacenamiento. Desde aquí la foto cuenta y se ve.
create function public.api_m01_confirmar_foto(p_foto_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_f   m01_recepcion.fotos_meta;
begin
  perform core.exigir('M01', 'cargar_imagenes');
  select * into v_f from m01_recepcion.fotos_meta where foto_id = p_foto_id for update;
  if not found then
    raise exception 'E_NO_ENCONTRADO|La foto no está registrada o su registro venció. Vuelve a agregarla.';
  end if;
  if v_f.subido_por is distinct from v_uid and not core.tiene_permiso('M01', 'eliminar') then
    raise exception 'E_PERMISO|Solo quien subió la foto (o un administrador) puede confirmarla.';
  end if;
  if v_f.confirmada then
    return jsonb_build_object('foto_id', v_f.foto_id, 'nn', v_f.nn, 'confirmada', true);
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'm01-recepcion-fotos' and name = v_f.ruta) then
    raise exception 'E_FOTOS|La foto no llegó al almacenamiento. Inténtalo de nuevo.';
  end if;
  update m01_recepcion.fotos_meta set confirmada = true where foto_id = p_foto_id;
  perform core.auditar('M01', 'subir_foto', 'recepcion', v_f.recepcion_id, jsonb_build_object('foto_id', v_f.foto_id));
  return jsonb_build_object('foto_id', v_f.foto_id, 'nn', v_f.nn, 'confirmada', true);
end $$;

-- Fotos confirmadas de una recepción (con la ruta para pedir el enlace temporal).
create function public.api_m01_fotos_recepcion(p_recepcion_id text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.exigir('M01', 'ver');
  if not exists (select 1 from m01_recepcion.recepciones r
                 where r.recepcion_id = p_recepcion_id
                   and (r.estado <> 'eliminado' or core.tiene_permiso('M01', 'eliminar'))) then
    raise exception 'E_NO_ENCONTRADO|La recepción no existe.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
            'foto_id', f.foto_id, 'nn', f.nn, 'nombre', f.nombre, 'tipo_mime', f.tipo_mime,
            'tamano_bytes', f.tamano_bytes, 'ruta', f.ruta, 'subido_en', f.subido_en) order by f.nn)
          from m01_recepcion.fotos_meta f where f.recepcion_id = p_recepcion_id and f.confirmada), '[]'::jsonb);
end $$;

-- Quita el registro de una foto (también sirve para un intento que falló). Libera el cupo.
-- La aplicación borra primero el archivo del bucket; esta función borra el registro.
create function public.api_m01_eliminar_foto(p_foto_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_f   m01_recepcion.fotos_meta;
  v_r   m01_recepcion.recepciones;
begin
  perform core.exigir('M01', 'cargar_imagenes');
  select * into v_f from m01_recepcion.fotos_meta where foto_id = p_foto_id for update;
  if not found then
    raise exception 'E_NO_ENCONTRADO|La foto no existe.';
  end if;
  select * into v_r from m01_recepcion.recepciones where recepcion_id = v_f.recepcion_id;
  if v_r.estado not in ('borrador', 'cerrado') then
    raise exception 'E_ESTADO|No se pueden quitar fotos de una recepción anulada o eliminada.';
  end if;
  if v_r.creado_por is distinct from v_uid and not core.tiene_permiso('M01', 'eliminar') then
    raise exception 'E_PERMISO|Solo quien creó la recepción (o un administrador) puede quitarle fotos.';
  end if;
  delete from m01_recepcion.fotos_meta where foto_id = p_foto_id;
  perform core.auditar('M01', 'eliminar_foto', 'recepcion', v_f.recepcion_id,
                       jsonb_build_object('foto_id', v_f.foto_id, 'confirmada', v_f.confirmada));
  return jsonb_build_object('foto_id', p_foto_id, 'eliminada', true);
end $$;

-- ---------------------------------------------------------------- 3) políticas de almacenamiento
-- Las políticas consultan fotos_meta a través de esta función (las tablas del módulo no son visibles para los usuarios).
create function public.m01_foto_permitida(p_ruta text, p_accion text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_accion
    when 'subir' then
      core.tiene_permiso('M01', 'cargar_imagenes')
      and exists (select 1 from m01_recepcion.fotos_meta f
                  where f.ruta = p_ruta and not f.confirmada and f.subido_por = auth.uid())
    when 'ver' then
      core.tiene_permiso('M01', 'ver')
      and exists (select 1 from m01_recepcion.fotos_meta f
                  join m01_recepcion.recepciones r on r.recepcion_id = f.recepcion_id
                  where f.ruta = p_ruta
                    and (f.confirmada or f.subido_por = auth.uid())
                    and (r.estado <> 'eliminado' or core.tiene_permiso('M01', 'eliminar')))
    when 'borrar' then
      core.tiene_permiso('M01', 'cargar_imagenes')
      and exists (select 1 from m01_recepcion.fotos_meta f
                  join m01_recepcion.recepciones r on r.recepcion_id = f.recepcion_id
                  where f.ruta = p_ruta
                    and r.estado in ('borrador', 'cerrado')
                    and (r.creado_por = auth.uid() or core.tiene_permiso('M01', 'eliminar')))
    else false
  end
$$;

revoke all on function public.m01_foto_permitida(text, text) from public, anon;
grant execute on function public.m01_foto_permitida(text, text) to authenticated;

drop policy if exists m01_fotos_subir  on storage.objects;
drop policy if exists m01_fotos_ver    on storage.objects;
drop policy if exists m01_fotos_borrar on storage.objects;

create policy m01_fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'm01-recepcion-fotos' and public.m01_foto_permitida(name, 'subir'));
create policy m01_fotos_ver on storage.objects for select to authenticated
  using (bucket_id = 'm01-recepcion-fotos' and public.m01_foto_permitida(name, 'ver'));
create policy m01_fotos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'm01-recepcion-fotos' and public.m01_foto_permitida(name, 'borrar'));

-- Solo usuarios con sesión (authenticated) ejecutan las funciones api_*.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('api_m01_registrar_foto', 'api_m01_confirmar_foto', 'api_m01_fotos_recepcion', 'api_m01_eliminar_foto')
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;
