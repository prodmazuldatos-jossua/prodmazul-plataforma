-- Prodmazul · Fase 5 · Parte 6 · Estado del respaldo y alerta de 6 horas (para la aplicación)
-- Agrega DOS funciones de lectura para quienes administran (permiso admin_config del módulo M01, o administrador general):
--   * api_respaldo_resumen()      -> lo que muestra el indicador «Respaldo: hace X minutos» y el aviso en rojo.
--   * api_respaldo_errores(p_n)   -> el detalle de errores (datos, fotos, purga y corridas con problema).
-- NO modifica datos, NO envía correos y NO cambia ninguna tabla. Las reglas del aviso salen de este servidor
-- (así el reloj del teléfono o de la tablet no puede engañar al indicador).

-- ---------------------------------------------------------------- 1) resumen para el indicador
create or replace function public.api_respaldo_resumen() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_max     integer := core.sync_cfg_int('sync_max_intentos', 5);
  v_horas   integer := greatest(1, core.sync_cfg_int('sync_alerta_horas', 6));
  v_activa  boolean := coalesce((select (valor = 'true'::jsonb) from core.config where clave = 'sync_activa'), false);
  v_purga   boolean := coalesce((select (valor = 'true'::jsonb) from core.config where clave = 'purga_activa'), false);
  v_e       core.sync_estado;
  v_pend integer; v_err integer; v_ago integer;
  v_fsin integer; v_fviejo timestamptz; v_ferr integer; v_fago integer;
  v_perr integer; v_pago integer;
  v_ult_sync record; v_ult_purga record;
  v_seg bigint;
  v_motivos jsonb := '[]'::jsonb;
  v_problemas integer := 0;
  v_nivel text;
begin
  perform core.exigir('M01', 'admin_config');
  select * into v_e from core.sync_estado where id = 1;

  select count(*) filter (where estado in ('pendiente', 'enviando')),
         count(*) filter (where estado = 'error' and intentos < v_max),
         count(*) filter (where estado = 'error' and intentos >= v_max)
    into v_pend, v_err, v_ago
    from core.sync_cola;

  select count(*), min(f.subido_en)
    into v_fsin, v_fviejo
    from m01_recepcion.fotos_meta f
   where f.confirmada and f.drive_file_id is null and f.purgada_supabase_en is null;
  select count(*) filter (where s.ultimo_error is not null and s.intentos < v_max),
         count(*) filter (where s.intentos >= v_max)
    into v_ferr, v_fago
    from core.sync_fotos s join m01_recepcion.fotos_meta f using (foto_id)
   where f.drive_file_id is null and f.purgada_supabase_en is null;

  select count(*) filter (where p.ultimo_error is not null and p.intentos < v_max),
         count(*) filter (where p.intentos >= v_max)
    into v_perr, v_pago
    from core.purga_fotos p join m01_recepcion.fotos_meta f using (foto_id)
   where f.purgada_supabase_en is null;

  select ejecucion_id, origen, pedida_en, terminada_en,
         case when estado = 'pedida' and pedida_en < now() - interval '5 minutes' then 'sin_respuesta' else estado end as estado,
         left(error, 300) as error
    into v_ult_sync from core.sync_ejecuciones order by ejecucion_id desc limit 1;
  select purga_id, origen, pedida_en, terminada_en,
         case when estado = 'pedida' and pedida_en < now() - interval '5 minutes' then 'sin_respuesta' else estado end as estado,
         left(error, 300) as error
    into v_ult_purga from core.purga_ejecuciones order by purga_id desc limit 1;

  v_seg := case when v_e.ultima_sync_ok_en is null then null
                else greatest(0, floor(extract(epoch from (now() - v_e.ultima_sync_ok_en)))::bigint) end;

  -- Motivos del aviso en rojo (solo si el respaldo está encendido).
  if v_activa then
    if v_e.ultima_sync_ok_en is null then
      v_motivos := v_motivos || jsonb_build_object('codigo', 'sin_sincronizar',
        'texto', 'Todavía no hay ninguna sincronización correcta con Google.');
    elsif v_seg > v_horas * 3600 then
      v_motivos := v_motivos || jsonb_build_object('codigo', 'sync_vieja',
        'texto', format('Hace más de %s horas que los datos no se respaldan en Google Sheets.', v_horas));
    end if;
    if v_fviejo is not null and v_fviejo < now() - make_interval(hours => v_horas) then
      v_motivos := v_motivos || jsonb_build_object('codigo', 'fotos_viejas',
        'texto', format('Hay fotos esperando respaldo en Drive desde hace más de %s horas.', v_horas));
    end if;
  end if;

  v_problemas := v_err + v_ago + v_ferr + v_fago + v_perr + v_pago
                 + case when v_ult_sync.estado in ('con_error', 'sin_respuesta') then 1 else 0 end
                 + case when v_ult_purga.estado in ('con_error', 'sin_respuesta') then 1 else 0 end;

  v_nivel := case when not v_activa then 'apagada'
                  when jsonb_array_length(v_motivos) > 0 then 'alerta'
                  when v_problemas > 0 then 'aviso'
                  else 'ok' end;

  return jsonb_build_object(
    'ahora', now(),
    'activa', v_activa,
    'nivel', v_nivel,
    'alerta', jsonb_array_length(v_motivos) > 0,
    'motivos', v_motivos,
    'limite_horas', v_horas,
    'ultima_sync_ok_en', v_e.ultima_sync_ok_en,
    'segundos_sin_sincronizar', v_seg,
    'ultimo_intento_en', v_e.ultimo_intento_en,
    'pendientes', v_pend,
    'con_error', v_err,
    'agotadas', v_ago,
    'fotos_sin_respaldo', v_fsin,
    'fotos_mas_antigua_en', v_fviejo,
    'fotos_con_error', v_ferr,
    'fotos_agotadas', v_fago,
    'purga_activa', v_purga,
    'purga_con_error', v_perr,
    'purga_agotadas', v_pago,
    'ultima_corrida', case when v_ult_sync.ejecucion_id is null then null else jsonb_build_object(
        'origen', v_ult_sync.origen, 'pedida_en', v_ult_sync.pedida_en, 'terminada_en', v_ult_sync.terminada_en,
        'estado', v_ult_sync.estado, 'error', v_ult_sync.error) end,
    'ultima_purga', case when v_ult_purga.purga_id is null then null else jsonb_build_object(
        'origen', v_ult_purga.origen, 'pedida_en', v_ult_purga.pedida_en, 'terminada_en', v_ult_purga.terminada_en,
        'estado', v_ult_purga.estado, 'error', v_ult_purga.error) end,
    'problemas', v_problemas);
end $$;

-- ---------------------------------------------------------------- 2) detalle de errores
create or replace function public.api_respaldo_errores(p_n integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_max integer := core.sync_cfg_int('sync_max_intentos', 5);
  v_n   integer := greatest(1, least(coalesce(p_n, 50), 200));
  v_cola jsonb; v_cola_total integer;
  v_fot jsonb;  v_fot_total integer;
  v_pur jsonb;  v_pur_total integer;
  v_ejec jsonb;
begin
  perform core.exigir('M01', 'admin_config');

  select count(*) into v_cola_total from core.sync_cola where estado = 'error';
  select coalesce(jsonb_agg(to_jsonb(x) order by x.cambiado_en desc), '[]'::jsonb) into v_cola
    from (select c.tabla, c.clave, c.operacion, c.intentos, c.intentos >= v_max as agotado,
                 left(c.ultimo_error, 300) as ultimo_error, c.cambiado_en, c.proximo_intento_en
            from core.sync_cola c where c.estado = 'error'
           order by c.cambiado_en desc limit v_n) x;

  select count(*) into v_fot_total
    from core.sync_fotos s join m01_recepcion.fotos_meta f using (foto_id)
   where f.drive_file_id is null and f.purgada_supabase_en is null and (s.ultimo_error is not null or s.intentos >= v_max);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.actualizado_en desc), '[]'::jsonb) into v_fot
    from (select s.foto_id, f.recepcion_id, s.intentos, s.intentos >= v_max as agotada,
                 left(s.ultimo_error, 300) as ultimo_error, s.proximo_intento_en, s.actualizado_en
            from core.sync_fotos s join m01_recepcion.fotos_meta f using (foto_id)
           where f.drive_file_id is null and f.purgada_supabase_en is null and (s.ultimo_error is not null or s.intentos >= v_max)
           order by s.actualizado_en desc limit v_n) x;

  select count(*) into v_pur_total
    from core.purga_fotos p join m01_recepcion.fotos_meta f using (foto_id)
   where f.purgada_supabase_en is null and (p.ultimo_error is not null or p.intentos >= v_max);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.actualizado_en desc), '[]'::jsonb) into v_pur
    from (select p.foto_id, f.recepcion_id, p.intentos, p.intentos >= v_max as agotada,
                 left(p.ultimo_error, 300) as ultimo_error, p.proximo_intento_en, p.actualizado_en
            from core.purga_fotos p join m01_recepcion.fotos_meta f using (foto_id)
           where f.purgada_supabase_en is null and (p.ultimo_error is not null or p.intentos >= v_max)
           order by p.actualizado_en desc limit v_n) x;

  -- Corridas recientes con problema (sincronización y purga), de la más nueva a la más vieja.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.pedida_en desc), '[]'::jsonb) into v_ejec
    from (select * from (
            select 'sincronizacion'::text as tipo, e.ejecucion_id as id, e.origen, e.pedida_en, e.terminada_en,
                   case when e.estado = 'pedida' and e.pedida_en < now() - interval '5 minutes' then 'sin_respuesta' else e.estado end as estado,
                   left(e.error, 300) as error
              from core.sync_ejecuciones e
            union all
            select 'purga', p.purga_id, p.origen, p.pedida_en, p.terminada_en,
                   case when p.estado = 'pedida' and p.pedida_en < now() - interval '5 minutes' then 'sin_respuesta' else p.estado end,
                   left(p.error, 300)
              from core.purga_ejecuciones p
          ) t
           where t.estado in ('con_error', 'sin_respuesta')
           order by t.pedida_en desc limit 10) x;

  return jsonb_build_object(
    'ahora', now(), 'maximo_intentos', v_max,
    'datos',   jsonb_build_object('total', v_cola_total, 'items', v_cola),
    'fotos',   jsonb_build_object('total', v_fot_total,  'items', v_fot),
    'purga',   jsonb_build_object('total', v_pur_total,  'items', v_pur),
    'corridas', v_ejec,
    'ultimo_error', (select jsonb_build_object('texto', left(ultimo_error, 300), 'en', ultimo_error_en)
                       from core.sync_estado where id = 1 and ultimo_error is not null));
end $$;

-- ---------------------------------------------------------------- 3) permisos de ejecución
revoke all on function public.api_respaldo_resumen()        from public, anon;
revoke all on function public.api_respaldo_errores(integer) from public, anon;
grant execute on function public.api_respaldo_resumen()        to authenticated;
grant execute on function public.api_respaldo_errores(integer) to authenticated;
