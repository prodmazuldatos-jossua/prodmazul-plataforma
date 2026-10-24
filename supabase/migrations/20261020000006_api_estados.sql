-- Prodmazul · Fase 4 · Parte 5 · Migración 6: anular, eliminar y reactivar recepciones
-- Nada se borra físicamente: solo cambia el estado. Las recepciones anuladas y eliminadas
-- quedan fuera de los listados normales y de los reportes.
--
--   borrador / cerrado ──anular (permiso anular, con motivo)──▶ anulado
--   borrador / cerrado / anulado ──eliminar (permiso eliminar, con motivo)──▶ eliminado
--   anulado / eliminado ──reactivar (permiso eliminar)──▶ vuelve al estado que tenía antes

-- Carga y valida la recepción bloqueándola; comprueba la versión que vio quien opera.
create function m01_recepcion.cargar_para_cambio(p_id text, p_version integer)
returns m01_recepcion.recepciones
language plpgsql security definer set search_path = '' as $$
declare
  v_r m01_recepcion.recepciones;
begin
  select * into v_r from m01_recepcion.recepciones where recepcion_id = p_id for update;
  if not found then
    raise exception 'E_NO_ENCONTRADO|La recepción no existe.';
  end if;
  if v_r.estado = 'eliminado' and not core.tiene_permiso('M01', 'eliminar') then
    raise exception 'E_NO_ENCONTRADO|La recepción no existe.';
  end if;
  if p_version is null or p_version <> v_r.version then
    raise exception 'E_VERSION|La recepción fue modificada por otra persona. Vuelve a abrirla para ver los cambios.';
  end if;
  return v_r;
end $$;

-- ---------------------------------------------------------------- anular
create function public.api_m01_anular(p_id text, p_motivo text, p_version integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_r      m01_recepcion.recepciones;
begin
  perform core.exigir('M01', 'anular');
  v_r := m01_recepcion.cargar_para_cambio(p_id, p_version);
  if v_r.estado not in ('borrador', 'cerrado') then
    raise exception 'E_ESTADO|Solo se pueden anular recepciones en borrador o cerradas.';
  end if;
  if v_r.creado_por is distinct from v_uid and not core.tiene_permiso('M01', 'eliminar') then
    raise exception 'E_PERMISO|Solo quien creó la recepción (o un administrador) puede anularla.';
  end if;
  if char_length(v_motivo) < 5 then
    raise exception 'E_VALIDACION|El motivo de la anulación debe tener al menos 5 caracteres.';
  end if;
  if char_length(v_motivo) > 500 then
    raise exception 'E_VALIDACION|El motivo no puede superar los 500 caracteres.';
  end if;

  update m01_recepcion.recepciones set
    estado_previo = v_r.estado, estado = 'anulado', motivo_anulacion = v_motivo,
    anulado_por = v_uid, anulado_en = now(),
    version = version + 1, modificado_en = now(), modificado_por = v_uid
  where recepcion_id = p_id;

  perform core.auditar('M01', 'anular', 'recepcion', p_id,
                       jsonb_build_object('estado_previo', v_r.estado, 'motivo', v_motivo));
  return jsonb_build_object('recepcion_id', p_id, 'estado', 'anulado', 'version', v_r.version + 1);
end $$;

-- ---------------------------------------------------------------- eliminar
create function public.api_m01_eliminar(p_id text, p_motivo text, p_version integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_r      m01_recepcion.recepciones;
begin
  perform core.exigir('M01', 'eliminar');
  v_r := m01_recepcion.cargar_para_cambio(p_id, p_version);
  if v_r.estado = 'eliminado' then
    raise exception 'E_ESTADO|La recepción ya está eliminada.';
  end if;
  if char_length(v_motivo) < 5 then
    raise exception 'E_VALIDACION|El motivo de la eliminación debe tener al menos 5 caracteres.';
  end if;
  if char_length(v_motivo) > 500 then
    raise exception 'E_VALIDACION|El motivo no puede superar los 500 caracteres.';
  end if;

  -- Si ya estaba anulada, se conserva su estado anterior a la anulación (estado_previo) y los datos de la anulación.
  update m01_recepcion.recepciones set
    estado_previo = case when v_r.estado = 'anulado' then v_r.estado_previo else v_r.estado end,
    estado = 'eliminado', eliminado_por = v_uid, eliminado_en = now(),
    version = version + 1, modificado_en = now(), modificado_por = v_uid
  where recepcion_id = p_id;

  perform core.auditar('M01', 'eliminar', 'recepcion', p_id,
                       jsonb_build_object('estado_antes', v_r.estado, 'motivo', v_motivo));
  return jsonb_build_object('recepcion_id', p_id, 'estado', 'eliminado', 'version', v_r.version + 1);
end $$;

-- ---------------------------------------------------------------- reactivar
create function public.api_m01_reactivar(p_id text, p_version integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_r     m01_recepcion.recepciones;
  v_nuevo text;
begin
  perform core.exigir('M01', 'eliminar');
  v_r := m01_recepcion.cargar_para_cambio(p_id, p_version);
  if v_r.estado not in ('anulado', 'eliminado') then
    raise exception 'E_ESTADO|Solo se pueden reactivar recepciones anuladas o eliminadas.';
  end if;

  if v_r.estado = 'eliminado' and v_r.anulado_en is not null then
    -- estaba anulada antes de eliminarse: vuelve a anulada
    update m01_recepcion.recepciones set
      estado = 'anulado', eliminado_por = null, eliminado_en = null,
      version = version + 1, modificado_en = now(), modificado_por = v_uid
    where recepcion_id = p_id;
    v_nuevo := 'anulado';
  else
    v_nuevo := coalesce(v_r.estado_previo, 'borrador');
    update m01_recepcion.recepciones set
      estado = v_nuevo, estado_previo = null,
      motivo_anulacion = null, anulado_por = null, anulado_en = null,
      eliminado_por = null, eliminado_en = null,
      version = version + 1, modificado_en = now(), modificado_por = v_uid
    where recepcion_id = p_id;
  end if;

  perform core.auditar('M01', 'reactivar', 'recepcion', p_id,
                       jsonb_build_object('estado_antes', v_r.estado, 'estado_nuevo', v_nuevo));
  return jsonb_build_object('recepcion_id', p_id, 'estado', v_nuevo, 'version', v_r.version + 1);
end $$;

-- Solo usuarios con sesión (authenticated) ejecutan las funciones api_*.
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

-- Las funciones internas del módulo no se llaman desde la API.
revoke all on all functions in schema m01_recepcion from public, anon, authenticated;
