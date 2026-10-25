-- Prodmazul · Fase 4 · Parte 8 · Migración 10: el listado devuelve más datos
-- api_m01_listar_recepciones ahora devuelve también: llegada_en (bines o gavetas), creado_por (para saber si
-- la persona puede editar o anular), lote_cerrado (si el lote ya está cerrado) y motivo_anulacion.
-- No cambia ninguna tabla: solo reemplaza esta función.

create or replace function public.api_m01_listar_recepciones(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_b      text := core.normalizar(p->>'busqueda');
  v_estado text := coalesce(nullif(btrim(p->>'estado'), ''), 'activos');
  v_desde  date;
  v_hasta  date;
  v_lim    integer;
  v_off    integer;
  v_elim   boolean;
  v_total  integer;
  v_items  jsonb;
begin
  perform core.exigir('M01', 'ver');
  v_desde := nullif(btrim(coalesce(p->>'desde', '')), '')::date;
  v_hasta := nullif(btrim(coalesce(p->>'hasta', '')), '')::date;
  v_lim   := least(greatest(coalesce(nullif(p->>'limite', '')::integer, 20), 1), 100);
  v_off   := greatest(coalesce(nullif(p->>'desplazamiento', '')::integer, 0), 0);
  v_elim := core.tiene_permiso('M01', 'eliminar');
  if v_estado not in ('activos', 'todos', 'borrador', 'cerrado', 'anulado', 'eliminado') then
    raise exception 'E_VALIDACION|Estado de filtro no válido.';
  end if;
  if v_estado = 'eliminado' and not v_elim then
    raise exception 'E_PERMISO|No tienes permiso para ver recepciones eliminadas.';
  end if;

  with f as (
    select r.*, pr.nombre as proveedor_nombre, es.nombre as especie_nombre, pf.nombre as realizado_por_nombre,
           (select lo.cerrado from core.lotes lo where lo.lote_id = r.lote_id) as lote_cerrado
    from m01_recepcion.recepciones r
    join core.proveedores pr on pr.id = r.proveedor_id
    join core.especies es on es.id = r.especie_id
    left join core.perfiles pf on pf.user_id = r.realizado_por
    where (case v_estado
             when 'activos'  then r.estado in ('borrador', 'cerrado')
             when 'todos'    then r.estado in ('borrador', 'cerrado', 'anulado') or (v_elim and r.estado = 'eliminado')
             else r.estado = v_estado end)
      and (v_desde is null or r.fecha_llegada >= v_desde)
      and (v_hasta is null or r.fecha_llegada <= v_hasta)
      and (v_b = '' or core.normalizar(
             r.recepcion_id || ' ' || r.guia_remision || ' ' || r.lote_id || ' ' || coalesce(r.placa_vehiculo, '')
             || ' ' || pr.nombre || ' ' || es.nombre) like '%' || v_b || '%')
  ), pagina as (
    select * from f order by fecha_llegada desc, recepcion_id desc limit v_lim offset v_off
  )
  select (select count(*) from f),
         coalesce((select jsonb_agg(jsonb_build_object(
           'recepcion_id', x.recepcion_id, 'fecha_llegada', x.fecha_llegada, 'lote_id', x.lote_id,
           'proveedor_nombre', x.proveedor_nombre, 'especie_nombre', x.especie_nombre,
           'guia_remision', x.guia_remision, 'placa_vehiculo', x.placa_vehiculo,
           'num_gavetas_bines', x.num_gavetas_bines,
           'libras_reportadas', x.libras_reportadas, 'libras_planta', x.libras_planta,
           'diferencia_lb', x.diferencia_lb, 'diferencia_pct', x.diferencia_pct,
           'estado', x.estado, 'version', x.version, 'realizado_por_nombre', x.realizado_por_nombre,
           'modificado_en', x.modificado_en, 'llegada_en', x.llegada_en, 'creado_por', x.creado_por,
           'lote_cerrado', x.lote_cerrado, 'motivo_anulacion', x.motivo_anulacion) order by x.fecha_llegada desc, x.recepcion_id desc)
           from pagina x), '[]'::jsonb)
    into v_total, v_items;

  return jsonb_build_object('total', v_total, 'items', v_items);
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
       or numeric_value_out_of_range or invalid_parameter_value then
    raise exception 'E_VALIDACION|Alguno de los filtros tiene un valor no válido.';
end $$;

revoke all on function public.api_m01_listar_recepciones(jsonb) from public, anon;
grant execute on function public.api_m01_listar_recepciones(jsonb) to authenticated;
