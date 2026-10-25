-- Prodmazul · Fase 4 · Parte 6 · Migración 7: acumulado de un lote
-- api_obtener_lote ahora también devuelve cuántos camiones (recepciones) y cuántas libras lleva el lote.
-- Cuentan solo las recepciones en borrador o cerradas: las anuladas y eliminadas no suman.
-- Se cambia la función en su lugar (misma firma), así que los permisos se conservan.

create or replace function public.api_obtener_lote(p_lote text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_lote text;
  v_r    record;
  v_acum record;
begin
  perform core.exigir('M01', 'ver');
  v_lote := core.validar_lote(p_lote);
  select l.lote_id, p.nombre as proveedor_nombre, e.nombre as especie_nombre
    into v_r
  from core.lotes l
  join core.proveedores p on p.id = l.proveedor_id
  left join core.especies e on e.id = l.especie_id
  where l.lote_id = v_lote;
  if not found then
    return jsonb_build_object('existe', false, 'lote_id', v_lote,
                              'camiones', 0, 'libras_reportadas', 0, 'libras_planta', 0);
  end if;
  select count(*) as camiones,
         coalesce(sum(libras_reportadas), 0) as reportadas,
         coalesce(sum(libras_planta), 0) as planta
    into v_acum
  from m01_recepcion.recepciones
  where lote_id = v_lote and estado in ('borrador', 'cerrado');
  return jsonb_build_object('existe', true, 'lote_id', v_r.lote_id,
                            'proveedor_nombre', v_r.proveedor_nombre, 'especie_nombre', v_r.especie_nombre,
                            'camiones', v_acum.camiones,
                            'libras_reportadas', v_acum.reportadas, 'libras_planta', v_acum.planta);
end $$;

revoke all on function public.api_obtener_lote(text) from public, anon;
grant execute on function public.api_obtener_lote(text) to authenticated;
