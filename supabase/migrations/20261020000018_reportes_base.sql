-- Prodmazul · Fase 5 · Parte 7 · Reportes en la base de datos (módulo 1: Recepción)
-- Agrega TRES funciones de lectura para la pantalla de reportes (Parte 8) y un índice para que respondan rápido con miles de recepciones:
--   * api_m01_rep_periodos(desde, hasta, periodo, borradores)        -> libras planta y lotes por DÍA, SEMANA (empieza el lunes) o MES.
--   * api_m01_rep_proveedores(desde, hasta, borradores)              -> total de proveedores y libras por proveedor.
--   * api_m01_rep_especie_proveedor(desde, hasta, borradores)        -> especie por proveedor (y total por especie).
-- Reglas (decididas en la Fase 5):
--   - Las libras son «libras planta» (libras_planta). Los reportes devuelven LIBRAS; la conversión a kg la hace la aplicación.
--   - Se cuenta por la fecha de llegada (fecha_llegada). La semana empieza el lunes.
--   - NO cuentan las recepciones anuladas ni eliminadas. Los borradores tampoco, salvo que se pida (p_borradores = true).
--   - Un lote cuenta UNA vez por periodo aunque haya llegado en varios camiones (conteo de lotes distintos).
--   - Requieren el permiso «ver_reportes» del módulo 1. Solo leen: no cambian datos.
-- Los cálculos se hacen aquí, en la base de datos; nunca se leen desde Google Sheets.

-- ---------------------------------------------------------------- 1) índice para reportes
-- Cubre las columnas que usan los reportes: con él no hace falta leer la tabla completa (índice «solo índice»).
create index if not exists recepciones_reportes_idx on m01_recepcion.recepciones (fecha_llegada, estado)
  include (proveedor_id, especie_id, lote_id, libras_planta, libras_reportadas, diferencia_lb);

-- ---------------------------------------------------------------- 2) ayudas internas (no son públicas)
-- Valida y completa el rango de fechas. Sin fechas: del primer día del mes actual a hoy (hora de Ecuador).
create or replace function core.rep_rango(p_desde date, p_hasta date, p_max_dias integer, out o_desde date, out o_hasta date)
language plpgsql stable set search_path = '' as $$
declare v_hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  o_hasta := coalesce(p_hasta, v_hoy);
  o_desde := coalesce(p_desde, case when p_hasta is null then date_trunc('month', v_hoy::timestamp)::date else p_hasta - 29 end);
  if o_desde > o_hasta then
    raise exception 'E_VALIDACION|La fecha «desde» no puede ser posterior a la fecha «hasta».';
  end if;
  if o_desde < date '2000-01-01' or o_hasta > date '2100-01-01' then
    raise exception 'E_VALIDACION|Las fechas del reporte no son válidas.';
  end if;
  if (o_hasta - o_desde) > p_max_dias then
    raise exception 'E_VALIDACION|El rango es demasiado grande para este reporte (máximo % días).', p_max_dias;
  end if;
end $$;

create or replace function core.rep_estados(p_borradores boolean) returns text[]
language sql immutable set search_path = '' as $$
  select case when coalesce(p_borradores, false) then array['cerrado', 'borrador'] else array['cerrado'] end
$$;

-- ---------------------------------------------------------------- 3) libras y lotes por día, semana o mes
create or replace function public.api_m01_rep_periodos(
  p_desde date default null, p_hasta date default null, p_periodo text default 'dia', p_borradores boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_desde date; v_hasta date;
  v_unidad text; v_paso interval; v_max integer;
  v_estados text[] := core.rep_estados(p_borradores);
  v_filas jsonb; v_tot jsonb;
begin
  perform core.exigir('M01', 'ver_reportes');
  case lower(coalesce(p_periodo, ''))
    when 'dia'    then v_unidad := 'day';   v_paso := interval '1 day';   v_max := 400;
    when 'semana' then v_unidad := 'week';  v_paso := interval '1 week';  v_max := 1830;
    when 'mes'    then v_unidad := 'month'; v_paso := interval '1 month'; v_max := 3660;
    else raise exception 'E_VALIDACION|El periodo debe ser «dia», «semana» o «mes».';
  end case;
  select o_desde, o_hasta into v_desde, v_hasta from core.rep_rango(p_desde, p_hasta, v_max);

  with serie as (
    select g::date as inicio
      from generate_series(date_trunc(v_unidad, v_desde::timestamp), v_hasta::timestamp, v_paso) g
  ), datos as (
    select date_trunc(v_unidad, r.fecha_llegada::timestamp)::date as inicio,
           count(*) as recepciones,
           count(distinct r.lote_id) as lotes,
           coalesce(sum(r.libras_planta), 0) as libras_planta,
           coalesce(sum(r.libras_reportadas), 0) as libras_reportadas,
           coalesce(sum(r.diferencia_lb), 0) as diferencia_lb,
           sum(r.libras_reportadas) filter (where r.diferencia_lb is not null) as base_dif
      from m01_recepcion.recepciones r
     where r.fecha_llegada between v_desde and v_hasta and r.estado = any (v_estados)
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'inicio', s.inicio,
           'fin', case v_unidad when 'day' then s.inicio when 'week' then s.inicio + 6
                                else (s.inicio + interval '1 month')::date - 1 end,
           'parcial', s.inicio < v_desde or
                      (case v_unidad when 'day' then s.inicio when 'week' then s.inicio + 6
                                     else (s.inicio + interval '1 month')::date - 1 end) > v_hasta,
           'recepciones', coalesce(d.recepciones, 0),
           'lotes', coalesce(d.lotes, 0),
           'libras_planta', coalesce(d.libras_planta, 0),
           'libras_reportadas', coalesce(d.libras_reportadas, 0),
           'diferencia_lb', coalesce(d.diferencia_lb, 0),
           'diferencia_pct', case when coalesce(d.base_dif, 0) > 0 then round(d.diferencia_lb / d.base_dif * 100, 2) end
         ) order by s.inicio), '[]'::jsonb)
    into v_filas
    from serie s left join datos d using (inicio);

  select jsonb_build_object(
           'recepciones', count(*),
           'lotes', count(distinct r.lote_id),
           'libras_planta', coalesce(sum(r.libras_planta), 0),
           'libras_reportadas', coalesce(sum(r.libras_reportadas), 0),
           'diferencia_lb', coalesce(sum(r.diferencia_lb), 0),
           'diferencia_pct', case when coalesce(sum(r.libras_reportadas) filter (where r.diferencia_lb is not null), 0) > 0
                                  then round(sum(r.diferencia_lb) / (sum(r.libras_reportadas) filter (where r.diferencia_lb is not null)) * 100, 2) end)
    into v_tot
    from m01_recepcion.recepciones r
   where r.fecha_llegada between v_desde and v_hasta and r.estado = any (v_estados);

  return jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'periodo', lower(p_periodo),
                            'borradores', coalesce(p_borradores, false), 'filas', v_filas, 'totales', v_tot);
end $$;

-- ---------------------------------------------------------------- 4) proveedores y libras por proveedor
create or replace function public.api_m01_rep_proveedores(
  p_desde date default null, p_hasta date default null, p_borradores boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_desde date; v_hasta date;
  v_estados text[] := core.rep_estados(p_borradores);
  v_filas jsonb; v_tot jsonb; v_cat integer;
begin
  perform core.exigir('M01', 'ver_reportes');
  select o_desde, o_hasta into v_desde, v_hasta from core.rep_rango(p_desde, p_hasta, 3660);

  with datos as (
    select r.proveedor_id,
           count(*) as recepciones,
           count(distinct r.lote_id) as lotes,
           coalesce(sum(r.libras_planta), 0) as libras_planta,
           coalesce(sum(r.libras_reportadas), 0) as libras_reportadas,
           coalesce(sum(r.diferencia_lb), 0) as diferencia_lb
      from m01_recepcion.recepciones r
     where r.fecha_llegada between v_desde and v_hasta and r.estado = any (v_estados)
     group by r.proveedor_id
  ), total as (select coalesce(sum(libras_planta), 0) as t from datos)
  select coalesce(jsonb_agg(jsonb_build_object(
           'proveedor_id', d.proveedor_id, 'proveedor', p.nombre,
           'recepciones', d.recepciones, 'lotes', d.lotes,
           'libras_planta', d.libras_planta, 'libras_reportadas', d.libras_reportadas, 'diferencia_lb', d.diferencia_lb,
           'porcentaje', case when t.t > 0 then round(d.libras_planta / t.t * 100, 2) else 0 end
         ) order by d.libras_planta desc, p.nombre), '[]'::jsonb)
    into v_filas
    from datos d join core.proveedores p on p.id = d.proveedor_id cross join total t;

  select count(*) into v_cat from core.proveedores;
  select jsonb_build_object(
           'recepciones', count(*), 'lotes', count(distinct r.lote_id),
           'libras_planta', coalesce(sum(r.libras_planta), 0),
           'libras_reportadas', coalesce(sum(r.libras_reportadas), 0))
    into v_tot
    from m01_recepcion.recepciones r
   where r.fecha_llegada between v_desde and v_hasta and r.estado = any (v_estados);

  return jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'borradores', coalesce(p_borradores, false),
                            'proveedores_con_recepcion', jsonb_array_length(v_filas),
                            'proveedores_catalogo', v_cat, 'filas', v_filas, 'totales', v_tot);
end $$;

-- ---------------------------------------------------------------- 5) especie por proveedor
create or replace function public.api_m01_rep_especie_proveedor(
  p_desde date default null, p_hasta date default null, p_borradores boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_desde date; v_hasta date;
  v_estados text[] := core.rep_estados(p_borradores);
  v_filas jsonb; v_esp jsonb; v_tot jsonb;
begin
  perform core.exigir('M01', 'ver_reportes');
  select o_desde, o_hasta into v_desde, v_hasta from core.rep_rango(p_desde, p_hasta, 3660);

  select coalesce(jsonb_agg(jsonb_build_object(
           'proveedor_id', x.proveedor_id, 'proveedor', p.nombre, 'especie_id', x.especie_id, 'especie', e.nombre,
           'recepciones', x.recepciones, 'lotes', x.lotes,
           'libras_planta', x.libras_planta, 'libras_reportadas', x.libras_reportadas
         ) order by lower(p.nombre), x.libras_planta desc, e.nombre), '[]'::jsonb)
    into v_filas
    from (select r.proveedor_id, r.especie_id, count(*) as recepciones, count(distinct r.lote_id) as lotes,
                 coalesce(sum(r.libras_planta), 0) as libras_planta, coalesce(sum(r.libras_reportadas), 0) as libras_reportadas
            from m01_recepcion.recepciones r
           where r.fecha_llegada between v_desde and v_hasta and r.estado = any (v_estados)
           group by r.proveedor_id, r.especie_id) x
    join core.proveedores p on p.id = x.proveedor_id
    join core.especies e on e.id = x.especie_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'especie_id', x.especie_id, 'especie', e.nombre, 'recepciones', x.recepciones, 'lotes', x.lotes,
           'proveedores', x.proveedores, 'libras_planta', x.libras_planta
         ) order by x.libras_planta desc, e.nombre), '[]'::jsonb)
    into v_esp
    from (select r.especie_id, count(*) as recepciones, count(distinct r.lote_id) as lotes,
                 count(distinct r.proveedor_id) as proveedores, coalesce(sum(r.libras_planta), 0) as libras_planta
            from m01_recepcion.recepciones r
           where r.fecha_llegada between v_desde and v_hasta and r.estado = any (v_estados)
           group by r.especie_id) x
    join core.especies e on e.id = x.especie_id;

  select jsonb_build_object('recepciones', count(*), 'lotes', count(distinct r.lote_id),
                            'proveedores', count(distinct r.proveedor_id), 'especies', count(distinct r.especie_id),
                            'libras_planta', coalesce(sum(r.libras_planta), 0))
    into v_tot
    from m01_recepcion.recepciones r
   where r.fecha_llegada between v_desde and v_hasta and r.estado = any (v_estados);

  return jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'borradores', coalesce(p_borradores, false),
                            'filas', v_filas, 'por_especie', v_esp, 'totales', v_tot);
end $$;

-- ---------------------------------------------------------------- 6) permisos de ejecución
revoke all on function core.rep_rango(date, date, integer) from public, anon, authenticated;
revoke all on function core.rep_estados(boolean) from public, anon, authenticated;
revoke all on function public.api_m01_rep_periodos(date, date, text, boolean) from public, anon;
revoke all on function public.api_m01_rep_proveedores(date, date, boolean) from public, anon;
revoke all on function public.api_m01_rep_especie_proveedor(date, date, boolean) from public, anon;
grant execute on function public.api_m01_rep_periodos(date, date, text, boolean) to authenticated;
grant execute on function public.api_m01_rep_proveedores(date, date, boolean) to authenticated;
grant execute on function public.api_m01_rep_especie_proveedor(date, date, boolean) to authenticated;
