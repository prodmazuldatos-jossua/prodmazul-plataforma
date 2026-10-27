-- Fase 5 · Parte 10 · Configuración, auditoría, reabrir lotes y catálogo.
-- No borra ni cambia datos de recepciones. Quién puede entrar: el administrador general o quien tenga
-- el permiso «admin_config» del módulo 1 (rol «admin_modulo»).

-- 0) Quién administra
create function core.puede_administrar() returns boolean
language sql stable security definer set search_path = '' as $$
  select core.es_admin_general() or core.tiene_permiso('M01', 'admin_config')
$$;

create function core.exigir_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not core.puede_administrar() then
    raise exception 'E_PERMISO|No tienes permiso para realizar esta acción.';
  end if;
end $$;

-- ============================================================== 1) CONFIGURACIÓN
-- Lista de parámetros que se pueden cambiar desde la pantalla (los demás se activan con las guías).
create function core.config_def() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_array(
    jsonb_build_object('clave','dias_retencion_fotos','etiqueta','Días que se guardan las fotos en Supabase','tipo','entero','min',7,'max',3650,'defecto',60,
      'ayuda','Pasado este tiempo, y solo si la foto ya tiene copia confirmada en Drive, la purga puede borrarla de Supabase.'),
    jsonb_build_object('clave','purga_gracia_horas','etiqueta','Horas de espera tras la copia en Drive','tipo','entero','min',1,'max',720,'defecto',24,
      'ayuda','La copia de Drive debe tener al menos estas horas antes de que la foto pueda borrarse.'),
    jsonb_build_object('clave','purga_max_por_corrida','etiqueta','Fotos como máximo por corrida de purga','tipo','entero','min',1,'max',1000,'defecto',200,
      'ayuda','Límite de seguridad: cuántas fotos borra la purga cada vez que corre.'),
    jsonb_build_object('clave','factor_lb_kg','etiqueta','Factor libras por kilo','tipo','decimal','min',2.2,'max',2.21,'defecto',2.20462,
      'ayuda','Se usa para pasar kilos a libras. Afecta a las recepciones que se guarden desde ahora; las ya guardadas no cambian.'),
    jsonb_build_object('clave','max_fotos_recepcion','etiqueta','Máximo de fotos por recepción','tipo','entero','min',1,'max',20,'defecto',5,
      'ayuda','Las recepciones que ya tengan más fotos no se tocan.'),
    jsonb_build_object('clave','formato_lote','etiqueta','Formato del número de lote','tipo','regex','defecto',
      '^([A-Z]?[0-9]{3}|[0-9]{3}[A-Z]?)(-([A-Z]?[0-9]{3}|[0-9]{3}[A-Z]?)){2}$',
      'ayuda','Expresión regular (debe empezar con ^ y terminar con $). Los lotes ya creados no se revisan de nuevo.'),
    jsonb_build_object('clave','sync_alerta_horas','etiqueta','Horas sin copia a Sheets para avisar','tipo','entero','min',1,'max',168,'defecto',6,
      'ayuda','Si pasan más horas sin sincronizar, el indicador de respaldo pasa a aviso o alerta.'),
    jsonb_build_object('clave','sync_dias_historial','etiqueta','Días que se conserva lo ya enviado a Sheets','tipo','entero','min',1,'max',365,'defecto',14,
      'ayuda','Limpieza de la cola de envío; no borra datos de recepciones.')
  )
$$;

-- Valida un valor y devuelve el valor ya normalizado. Lanza E_VALIDACION si no sirve.
create function core.config_validar(p_clave text, p_valor jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  d   jsonb;
  v_t text;
  n   numeric;
  s   text;
begin
  select x into d from jsonb_array_elements(core.config_def()) x where x ->> 'clave' = p_clave;
  if d is null then
    raise exception 'E_VALIDACION|Ese parámetro no se puede cambiar desde aquí.';
  end if;
  v_t := d ->> 'tipo';
  if v_t in ('entero', 'decimal') then
    if p_valor is null or jsonb_typeof(p_valor) <> 'number' then
      raise exception 'E_VALIDACION|El valor debe ser un número.';
    end if;
    n := (p_valor #>> '{}')::numeric;
    if v_t = 'entero' and n <> trunc(n) then
      raise exception 'E_VALIDACION|El valor debe ser un número entero.';
    end if;
    if v_t = 'decimal' and n <> round(n, 5) then
      raise exception 'E_VALIDACION|El valor puede tener como máximo 5 decimales.';
    end if;
    if n < (d ->> 'min')::numeric or n > (d ->> 'max')::numeric then
      raise exception 'E_VALIDACION|El valor debe estar entre % y %.', d ->> 'min', d ->> 'max';
    end if;
    return to_jsonb(n);
  end if;
  -- regex
  if p_valor is null or jsonb_typeof(p_valor) <> 'string' then
    raise exception 'E_VALIDACION|El valor debe ser un texto.';
  end if;
  s := btrim(p_valor #>> '{}');
  if s = '' or char_length(s) > 200 then
    raise exception 'E_VALIDACION|El formato no puede estar vacío ni superar 200 caracteres.';
  end if;
  if left(s, 1) <> '^' or right(s, 1) <> '$' then
    raise exception 'E_VALIDACION|El formato debe empezar con ^ y terminar con $.';
  end if;
  begin
    perform '' ~ s;
  exception when others then
    raise exception 'E_VALIDACION|El formato no es una expresión regular válida.';
  end;
  if '' ~ s then
    raise exception 'E_VALIDACION|El formato no puede aceptar un lote vacío.';
  end if;
  return to_jsonb(s);
end $$;

create function public.api_admin_config_listar() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.exigir_admin();
  return jsonb_build_object('parametros', (
    select jsonb_agg(
             o.d || jsonb_build_object(
               'valor', coalesce(c.valor, o.d -> 'defecto'),
               'cambiado_en', u.creado_en,
               'cambiado_por', coalesce(nullif(pf.nombre, ''), pf.correo))
             order by o.ord)
    from jsonb_array_elements(core.config_def()) with ordinality as o(d, ord)
    left join core.config c on c.clave = o.d ->> 'clave'
    left join lateral (
      select a.creado_en, a.user_id from core.auditoria a
      where a.accion = 'cambiar_config' and a.entidad = 'config' and a.entidad_id = o.d ->> 'clave'
      order by a.evento_id desc limit 1) u on true
    left join core.perfiles pf on pf.user_id = u.user_id
  ));
end $$;

create function public.api_admin_config_cambiar(p_clave text, p_valor jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_clave text := btrim(coalesce(p_clave, ''));
  v_nuevo jsonb;
  v_ant   jsonb;
begin
  perform core.exigir_admin();
  v_nuevo := core.config_validar(v_clave, p_valor);
  select valor into v_ant from core.config where clave = v_clave for update;
  if v_ant is null then
    select x -> 'defecto' into v_ant from jsonb_array_elements(core.config_def()) x where x ->> 'clave' = v_clave;
  end if;
  if v_ant = v_nuevo then
    return jsonb_build_object('clave', v_clave, 'valor', v_nuevo, 'cambio', false);
  end if;
  insert into core.config (clave, valor) values (v_clave, v_nuevo)
  on conflict (clave) do update set valor = excluded.valor;
  perform core.auditar('CORE', 'cambiar_config', 'config', v_clave,
                       jsonb_build_object('antes', v_ant, 'despues', v_nuevo));
  return jsonb_build_object('clave', v_clave, 'valor', v_nuevo, 'cambio', true);
end $$;

-- ============================================================== 2) CONSULTA DE LA AUDITORÍA
-- p: { desde 'AAAA-MM-DD', hasta 'AAAA-MM-DD' (día de Ecuador, inclusive), usuario (uuid), modulo, accion, texto,
--      pagina (1..), por_pagina (1..100, 30) }
create function public.api_admin_auditoria(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_desde  date;
  v_hasta  date;
  v_ini    timestamptz;
  v_fin    timestamptz;
  v_user   uuid;
  v_mod    text := nullif(btrim(coalesce(p ->> 'modulo', '')), '');
  v_acc    text := nullif(btrim(coalesce(p ->> 'accion', '')), '');
  v_txt    text := nullif(btrim(coalesce(p ->> 'texto', '')), '');
  v_pag    integer;
  v_pp     integer;
  v_total  bigint;
begin
  perform core.exigir_admin();
  p := coalesce(p, '{}'::jsonb);
  begin
    v_desde := nullif(btrim(coalesce(p ->> 'desde', '')), '')::date;
    v_hasta := nullif(btrim(coalesce(p ->> 'hasta', '')), '')::date;
  exception when others then
    raise exception 'E_VALIDACION|Las fechas deben tener el formato AAAA-MM-DD.';
  end;
  begin
    v_user := nullif(btrim(coalesce(p ->> 'usuario', '')), '')::uuid;
  exception when others then
    raise exception 'E_VALIDACION|El usuario indicado no es válido.';
  end;
  if v_desde is not null and v_hasta is not null and v_desde > v_hasta then
    raise exception 'E_VALIDACION|La fecha «desde» no puede ser posterior a «hasta».';
  end if;
  begin
    v_pag := greatest(coalesce(nullif(p ->> 'pagina', '')::integer, 1), 1);
    v_pp  := least(greatest(coalesce(nullif(p ->> 'por_pagina', '')::integer, 30), 1), 100);
  exception when others then
    raise exception 'E_VALIDACION|La página debe ser un número.';
  end;
  v_ini := case when v_desde is not null then (v_desde::timestamp at time zone 'America/Guayaquil') end;
  v_fin := case when v_hasta is not null then ((v_hasta + 1)::timestamp at time zone 'America/Guayaquil') end;

  select count(*) into v_total
  from core.auditoria a
  where (v_ini is null or a.creado_en >= v_ini)
    and (v_fin is null or a.creado_en < v_fin)
    and (v_user is null or a.user_id = v_user)
    and (v_mod is null or a.modulo_id = v_mod)
    and (v_acc is null or a.accion = v_acc)
    and (v_txt is null or a.entidad_id ilike '%' || v_txt || '%' or a.entidad ilike '%' || v_txt || '%');

  return jsonb_build_object(
    'total', v_total, 'pagina', v_pag, 'por_pagina', v_pp,
    'filas', (
      select coalesce(jsonb_agg(f order by f.evento_id desc), '[]'::jsonb)
      from (
        select a.evento_id, a.creado_en, a.user_id as quien_id,
               coalesce(nullif(pf.nombre, ''), pf.correo) as quien,
               a.modulo_id as modulo, a.accion, a.entidad, a.entidad_id, a.resultado,
               a.detalle - 'clave' - 'password' - 'contrasena' - 'contraseña' as detalle
        from core.auditoria a
        left join core.perfiles pf on pf.user_id = a.user_id
        where (v_ini is null or a.creado_en >= v_ini)
          and (v_fin is null or a.creado_en < v_fin)
          and (v_user is null or a.user_id = v_user)
          and (v_mod is null or a.modulo_id = v_mod)
          and (v_acc is null or a.accion = v_acc)
          and (v_txt is null or a.entidad_id ilike '%' || v_txt || '%' or a.entidad ilike '%' || v_txt || '%')
        order by a.evento_id desc
        offset (v_pag - 1) * v_pp limit v_pp
      ) f),
    'opciones', jsonb_build_object(
      'usuarios', (select coalesce(jsonb_agg(jsonb_build_object('id', x.user_id, 'nombre', x.n) order by x.n), '[]'::jsonb)
                   from (select distinct a.user_id, coalesce(nullif(pf.nombre, ''), pf.correo, 'Sistema') as n
                         from core.auditoria a left join core.perfiles pf on pf.user_id = a.user_id
                         where a.user_id is not null) x),
      'modulos',  (select coalesce(jsonb_agg(m order by m), '[]'::jsonb)
                   from (select distinct modulo_id as m from core.auditoria where modulo_id is not null) q),
      'acciones', (select coalesce(jsonb_agg(m order by m), '[]'::jsonb)
                   from (select distinct accion as m from core.auditoria) q)));
end $$;

create index auditoria_accion_idx on core.auditoria (modulo_id, accion, creado_en desc);
create index auditoria_usuario_idx on core.auditoria (user_id, creado_en desc);

-- ============================================================== 3) LOTES: LISTA Y REABRIR CON MOTIVO
-- p: { estado ('cerrados' | 'abiertos' | 'todos'; por defecto cerrados), busqueda, pagina (1..) } · 50 por página
create function public.api_admin_lotes(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_est text := coalesce(nullif(btrim(p ->> 'estado'), ''), 'cerrados');
  v_bus text := nullif(btrim(coalesce(p ->> 'busqueda', '')), '');
  v_pag integer;
  v_pp  constant integer := 50;
  v_tot bigint;
begin
  perform core.exigir_admin();
  p := coalesce(p, '{}'::jsonb);
  if v_est not in ('cerrados', 'abiertos', 'todos') then
    raise exception 'E_VALIDACION|El estado debe ser cerrados, abiertos o todos.';
  end if;
  begin
    v_pag := greatest(coalesce(nullif(p ->> 'pagina', '')::integer, 1), 1);
  exception when others then
    raise exception 'E_VALIDACION|La página debe ser un número.';
  end;
  select count(*) into v_tot
  from core.lotes l join core.proveedores pr on pr.id = l.proveedor_id
  where (v_est = 'todos' or (v_est = 'cerrados') = l.cerrado)
    and (v_bus is null or l.lote_id ilike '%' || v_bus || '%' or pr.nombre ilike '%' || v_bus || '%');
  return jsonb_build_object('total', v_tot, 'pagina', v_pag, 'por_pagina', v_pp, 'lotes', (
    select coalesce(jsonb_agg(x order by x.cerrado_en desc nulls last, x.lote_id), '[]'::jsonb)
    from (
      select l.lote_id, l.cerrado, l.cerrado_en,
             coalesce(nullif(cp.nombre, ''), cp.correo) as cerrado_por,
             pr.nombre as proveedor, e.nombre as especie,
             coalesce(a.camiones, 0) as camiones, coalesce(a.libras_planta, 0) as libras_planta
      from core.lotes l
      join core.proveedores pr on pr.id = l.proveedor_id
      left join core.especies e on e.id = l.especie_id
      left join core.perfiles cp on cp.user_id = l.cerrado_por
      left join lateral (select count(*) as camiones, sum(r.libras_planta) as libras_planta
                         from m01_recepcion.recepciones r
                         where r.lote_id = l.lote_id and r.estado in ('borrador', 'cerrado')) a on true
      where (v_est = 'todos' or (v_est = 'cerrados') = l.cerrado)
        and (v_bus is null or l.lote_id ilike '%' || v_bus || '%' or pr.nombre ilike '%' || v_bus || '%')
      order by l.cerrado_en desc nulls last, l.lote_id
      offset (v_pag - 1) * v_pp limit v_pp
    ) x));
end $$;

-- Reabrir un lote ahora exige motivo (la versión anterior, sin motivo, se reemplaza).
drop function public.api_m01_reabrir_lote(text);

create function public.api_m01_reabrir_lote(p_lote text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lote   text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_l      core.lotes;
  v_cam    integer;
begin
  perform core.exigir_admin();
  v_lote := core.validar_lote(p_lote);
  if char_length(v_motivo) < 5 then
    raise exception 'E_VALIDACION|El motivo debe tener al menos 5 caracteres.';
  end if;
  if char_length(v_motivo) > 500 then
    raise exception 'E_VALIDACION|El motivo no puede superar los 500 caracteres.';
  end if;
  select * into v_l from core.lotes where lote_id = v_lote for update;
  if not found then
    raise exception 'E_NO_ENCONTRADO|El lote no existe.';
  end if;
  if not v_l.cerrado then
    raise exception 'E_ESTADO|El lote ya está abierto.';
  end if;
  select count(*) into v_cam from m01_recepcion.recepciones where lote_id = v_lote and estado in ('borrador', 'cerrado');
  update core.lotes set cerrado = false, cerrado_en = null, cerrado_por = null where lote_id = v_lote;
  perform core.auditar('M01', 'reabrir_lote', 'lote', v_lote,
                       jsonb_build_object('motivo', v_motivo, 'cerrado_en', v_l.cerrado_en, 'camiones', v_cam));
  return jsonb_build_object('lote_id', v_lote, 'cerrado', false);
end $$;

-- ============================================================== 4) CATÁLOGO: VER Y UNIR DUPLICADOS
-- Al unir dos nombres, el nombre viejo queda como «alias» del que se conserva: si alguien lo escribe de nuevo,
-- el sistema lo asigna al nombre bueno y no vuelve a crear el duplicado.
create table core.catalogo_alias (
  tipo               text        not null check (tipo in ('proveedor', 'especie')),
  nombre_normalizado text        not null,
  nombre             text        not null,
  destino_id         uuid        not null,
  unido_en           timestamptz not null default now(),
  unido_por          uuid,
  primary key (tipo, nombre_normalizado)
);
alter table core.catalogo_alias enable row level security;
revoke all on core.catalogo_alias from public, anon, authenticated;

-- Clave para detectar nombres parecidos: sin tildes, signos, espacios ni sufijos legales (S.A., CIA. LTDA., ...).
create function core.clave_parecida(t text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(core.normalizar(t), '[^A-Z0-9]+', ' ', 'g'),
             '\m(SAS|S A S|S A|SA|CIA|LTDA|C A|CA)\M', ' ', 'g'),
           '\s+', '', 'g')
$$;

create or replace function core.obtener_o_crear_proveedor(p_nombre text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_norm text := core.normalizar(p_nombre);
  v_id   uuid;
begin
  if v_norm = '' then
    raise exception 'E_VALIDACION|El proveedor es obligatorio.';
  end if;
  select id into v_id from core.proveedores where nombre_normalizado = v_norm;
  if v_id is null then
    select destino_id into v_id from core.catalogo_alias where tipo = 'proveedor' and nombre_normalizado = v_norm;
  end if;
  if v_id is null then
    insert into core.proveedores (nombre, nombre_normalizado, creado_por)
    values (regexp_replace(btrim(p_nombre), '\s+', ' ', 'g'), v_norm, auth.uid())
    on conflict (nombre_normalizado) do update set nombre = core.proveedores.nombre
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function core.obtener_o_crear_especie(p_nombre text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_norm text := core.normalizar(p_nombre);
  v_id   uuid;
begin
  if v_norm = '' then
    raise exception 'E_VALIDACION|La especie es obligatoria.';
  end if;
  select id into v_id from core.especies where nombre_normalizado = v_norm;
  if v_id is null then
    select destino_id into v_id from core.catalogo_alias where tipo = 'especie' and nombre_normalizado = v_norm;
  end if;
  if v_id is null then
    insert into core.especies (nombre, nombre_normalizado, creado_por)
    values (regexp_replace(btrim(p_nombre), '\s+', ' ', 'g'), v_norm, auth.uid())
    on conflict (nombre_normalizado) do update set nombre = core.especies.nombre
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- p: { tipo ('proveedores' | 'especies'), busqueda, solo_parecidos (bool) } · hasta 500 filas
create function public.api_admin_catalogo(p jsonb default '{}'::jsonb) returns jsonb
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
                 'ultima_recepcion', t.ultima, 'parecidos', t.parecidos, 'grupo', case when t.parecidos > 1 then t.clave end)
               order by t.clave, t.nombre), '[]'::jsonb))
    into v_res
    from (
      select * from (
        select x.*, count(*) over (partition by x.clave) as parecidos
        from (
          select p0.id, p0.nombre, p0.activo, core.clave_parecida(p0.nombre) as clave,
                 (select count(*) from m01_recepcion.recepciones r where r.proveedor_id = p0.id and r.estado <> 'eliminado') as recepciones,
                 (select count(*) from core.lotes l where l.proveedor_id = p0.id) as lotes,
                 (select max(r.fecha_llegada) from m01_recepcion.recepciones r where r.proveedor_id = p0.id and r.estado <> 'eliminado') as ultima
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
                 'ultima_recepcion', t.ultima, 'parecidos', t.parecidos, 'grupo', case when t.parecidos > 1 then t.clave end)
               order by t.clave, t.nombre), '[]'::jsonb))
    into v_res
    from (
      select * from (
        select x.*, count(*) over (partition by x.clave) as parecidos
        from (
          select p0.id, p0.nombre, p0.activo, core.clave_parecida(p0.nombre) as clave,
                 (select count(*) from m01_recepcion.recepciones r where r.especie_id = p0.id and r.estado <> 'eliminado') as recepciones,
                 (select count(*) from core.lotes l where l.especie_id = p0.id) as lotes,
                 (select max(r.fecha_llegada) from m01_recepcion.recepciones r where r.especie_id = p0.id and r.estado <> 'eliminado') as ultima
          from core.especies p0) x) y
      where (v_bus is null or y.nombre ilike '%' || v_bus || '%')
        and (not v_solo or y.parecidos > 1)
      order by y.clave, y.nombre
      limit 500) t;
  end if;
  return v_res;
end $$;

-- Une el nombre «origen» en el nombre «destino»: pasa todas sus recepciones y lotes al destino, deja el nombre viejo
-- como alias y elimina el duplicado. Con motivo y auditoría. No se puede deshacer desde la pantalla.
create function public.api_admin_catalogo_unir(p_tipo text, p_origen uuid, p_destino uuid, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tipo   text := btrim(coalesce(p_tipo, ''));
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_o      record;
  v_d      record;
  v_rec    integer := 0;
  v_lot    integer := 0;
  v_k      text;
begin
  perform core.exigir_admin();
  if v_tipo not in ('proveedores', 'especies') then
    raise exception 'E_VALIDACION|El catálogo debe ser proveedores o especies.';
  end if;
  if p_origen is null or p_destino is null then
    raise exception 'E_VALIDACION|Debes elegir el nombre que se une y el que se conserva.';
  end if;
  if p_origen = p_destino then
    raise exception 'E_VALIDACION|El nombre que se une y el que se conserva deben ser distintos.';
  end if;
  if char_length(v_motivo) < 5 then
    raise exception 'E_VALIDACION|El motivo debe tener al menos 5 caracteres.';
  end if;
  if char_length(v_motivo) > 500 then
    raise exception 'E_VALIDACION|El motivo no puede superar los 500 caracteres.';
  end if;
  v_k := case v_tipo when 'proveedores' then 'proveedor' else 'especie' end;

  if v_tipo = 'proveedores' then
    -- se bloquean en orden fijo para evitar bloqueos cruzados
    perform 1 from core.proveedores where id in (p_origen, p_destino) order by id for update;
    select id, nombre, nombre_normalizado into v_o from core.proveedores where id = p_origen;
    select id, nombre, nombre_normalizado into v_d from core.proveedores where id = p_destino;
    if v_o.id is null or v_d.id is null then
      raise exception 'E_NO_ENCONTRADO|Uno de los nombres ya no existe.';
    end if;
    update core.lotes set proveedor_id = p_destino where proveedor_id = p_origen;
    get diagnostics v_lot = row_count;
    update m01_recepcion.recepciones set proveedor_id = p_destino, modificado_en = now(), modificado_por = auth.uid()
    where proveedor_id = p_origen;
    get diagnostics v_rec = row_count;
  else
    perform 1 from core.especies where id in (p_origen, p_destino) order by id for update;
    select id, nombre, nombre_normalizado into v_o from core.especies where id = p_origen;
    select id, nombre, nombre_normalizado into v_d from core.especies where id = p_destino;
    if v_o.id is null or v_d.id is null then
      raise exception 'E_NO_ENCONTRADO|Uno de los nombres ya no existe.';
    end if;
    update core.lotes set especie_id = p_destino where especie_id = p_origen;
    get diagnostics v_lot = row_count;
    update m01_recepcion.recepciones set especie_id = p_destino, modificado_en = now(), modificado_por = auth.uid()
    where especie_id = p_origen;
    get diagnostics v_rec = row_count;
  end if;

  -- los alias que ya apuntaban al nombre eliminado pasan al destino; el nombre eliminado también queda como alias
  update core.catalogo_alias set destino_id = p_destino where tipo = v_k and destino_id = p_origen;
  insert into core.catalogo_alias (tipo, nombre_normalizado, nombre, destino_id, unido_por)
  values (v_k, v_o.nombre_normalizado, v_o.nombre, p_destino, auth.uid())
  on conflict (tipo, nombre_normalizado) do update set destino_id = excluded.destino_id, nombre = excluded.nombre;

  if v_tipo = 'proveedores' then
    delete from core.proveedores where id = p_origen;
  else
    delete from core.especies where id = p_origen;
  end if;

  perform core.auditar('M01', 'unir_' || v_k, v_k, p_destino::text,
                       jsonb_build_object('motivo', v_motivo, 'origen_id', p_origen, 'origen_nombre', v_o.nombre,
                                          'destino_nombre', v_d.nombre, 'recepciones', v_rec, 'lotes', v_lot));
  return jsonb_build_object('destino_id', p_destino, 'destino_nombre', v_d.nombre, 'origen_nombre', v_o.nombre,
                            'recepciones', v_rec, 'lotes', v_lot);
end $$;

-- ============================================================== 5) PERMISOS
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('api_admin_config_listar', 'api_admin_config_cambiar', 'api_admin_auditoria',
                        'api_admin_lotes', 'api_m01_reabrir_lote', 'api_admin_catalogo', 'api_admin_catalogo_unir')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;
