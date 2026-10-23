-- Prodmazul · Fase 4 · Migración 1: núcleo transversal (esquema core)
-- Las tablas NO se exponen por la API: todo acceso pasa por funciones api_* (migración 3).

create schema if not exists core;

-- ---------------------------------------------------------------- tablas
create table core.perfiles (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  nombre           text not null default '',
  correo           text not null,
  activo           boolean not null default true,
  es_admin_general boolean not null default false,
  creado_en        timestamptz not null default now()
);

create table core.modulos (
  modulo_id  text primary key,
  nombre     text not null,
  ruta       text not null,
  habilitado boolean not null default true,
  orden      integer not null default 0
);

create table core.roles (
  rol_id text primary key,
  nombre text not null
);

create table core.permisos (
  permiso_id  text primary key,
  descripcion text not null
);

create table core.rol_permisos (
  rol_id     text not null references core.roles (rol_id) on delete cascade,
  permiso_id text not null references core.permisos (permiso_id) on delete cascade,
  primary key (rol_id, permiso_id)
);

create table core.usuario_modulo_rol (
  user_id   uuid not null references core.perfiles (user_id) on delete cascade,
  modulo_id text not null references core.modulos (modulo_id) on delete cascade,
  rol_id    text not null references core.roles (rol_id),
  primary key (user_id, modulo_id)
);

create table core.config (
  clave text primary key,
  valor jsonb not null
);

create table core.auditoria (
  evento_id  bigint generated always as identity primary key,
  creado_en  timestamptz not null default now(),
  user_id    uuid,
  modulo_id  text,
  accion     text not null,
  entidad    text,
  entidad_id text,
  resultado  text not null default 'ok',
  detalle    jsonb not null default '{}'::jsonb
);
create index auditoria_fecha_idx on core.auditoria (creado_en desc);
create index auditoria_entidad_idx on core.auditoria (entidad, entidad_id);

create table core.proveedores (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  nombre_normalizado text not null unique,
  activo            boolean not null default true,
  creado_en         timestamptz not null default now(),
  creado_por        uuid
);

create table core.especies (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  nombre_normalizado text not null unique,
  activo            boolean not null default true,
  creado_en         timestamptz not null default now(),
  creado_por        uuid
);

-- El lote es la clave de trazabilidad compartida por los módulos.
create table core.lotes (
  lote_id      text primary key,
  proveedor_id uuid not null references core.proveedores (id),
  especie_id   uuid references core.especies (id),
  activo       boolean not null default true,
  creado_en    timestamptz not null default now(),
  creado_por   uuid
);

-- ------------------------------------------------- seguridad: RLS sin políticas
alter table core.perfiles           enable row level security;
alter table core.modulos            enable row level security;
alter table core.roles              enable row level security;
alter table core.permisos           enable row level security;
alter table core.rol_permisos       enable row level security;
alter table core.usuario_modulo_rol enable row level security;
alter table core.config             enable row level security;
alter table core.auditoria          enable row level security;
alter table core.proveedores        enable row level security;
alter table core.especies           enable row level security;
alter table core.lotes              enable row level security;

-- ---------------------------------------------------------------- funciones
create function core.normalizar(t text) returns text
language sql immutable as $$
  select regexp_replace(
           upper(translate(btrim(coalesce(t, '')), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
           '\s+', ' ', 'g')
$$;

create function core.usuario_activo() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from core.perfiles where user_id = auth.uid() and activo)
$$;

create function core.tiene_permiso(p_modulo text, p_permiso text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from core.perfiles p
    join core.modulos m on m.modulo_id = p_modulo and m.habilitado
    where p.user_id = auth.uid()
      and p.activo
      and (
        p.es_admin_general
        or exists (
          select 1
          from core.usuario_modulo_rol u
          join core.rol_permisos rp on rp.rol_id = u.rol_id
          where u.user_id = p.user_id
            and u.modulo_id = p_modulo
            and rp.permiso_id = p_permiso
        )
      )
  )
$$;

create function core.exigir(p_modulo text, p_permiso text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not core.tiene_permiso(p_modulo, p_permiso) then
    raise exception 'E_PERMISO|No tienes permiso para realizar esta acción.';
  end if;
end $$;

create function core.auditar(
  p_modulo text, p_accion text, p_entidad text, p_entidad_id text, p_detalle jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into core.auditoria (user_id, modulo_id, accion, entidad, entidad_id, detalle)
  values (auth.uid(), p_modulo, p_accion, p_entidad, p_entidad_id, coalesce(p_detalle, '{}'::jsonb))
$$;

-- La auditoría es solo de inserción.
create function core.auditoria_inmutable() returns trigger
language plpgsql as $$
begin
  raise exception 'La auditoría no se puede modificar ni borrar.';
end $$;

create trigger auditoria_no_update before update or delete on core.auditoria
  for each row execute function core.auditoria_inmutable();

-- Catálogos que se alimentan al escribir (sin carga inicial).
create function core.obtener_o_crear_proveedor(p_nombre text) returns uuid
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
    insert into core.proveedores (nombre, nombre_normalizado, creado_por)
    values (regexp_replace(btrim(p_nombre), '\s+', ' ', 'g'), v_norm, auth.uid())
    on conflict (nombre_normalizado) do update set nombre = core.proveedores.nombre
    returning id into v_id;
  end if;
  return v_id;
end $$;

create function core.obtener_o_crear_especie(p_nombre text) returns uuid
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
    insert into core.especies (nombre, nombre_normalizado, creado_por)
    values (regexp_replace(btrim(p_nombre), '\s+', ' ', 'g'), v_norm, auth.uid())
    on conflict (nombre_normalizado) do update set nombre = core.especies.nombre
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Valida el formato del lote con la expresión regular guardada en core.config.
create function core.validar_lote(p_lote text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_lote  text := upper(btrim(coalesce(p_lote, '')));
  v_regex text;
begin
  select valor #>> '{}' into v_regex from core.config where clave = 'formato_lote';
  if v_lote = '' then
    raise exception 'E_VALIDACION|El lote es obligatorio.';
  end if;
  if v_regex is not null and v_lote !~* v_regex then
    raise exception 'E_VALIDACION|El formato del lote no es válido. Son 3 segmentos separados por guion (por ejemplo 123-456A-789).';
  end if;
  return v_lote;
end $$;

-- Cada usuario nuevo de Auth recibe un perfil sin permisos.
create function core.nuevo_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into core.perfiles (user_id, correo, nombre)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'nombre', ''))
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger al_crear_usuario after insert on auth.users
  for each row execute function core.nuevo_usuario();

-- Usuarios que ya existían antes de esta migración (por ejemplo, el administrador).
insert into core.perfiles (user_id, correo)
select id, coalesce(email, '') from auth.users
on conflict (user_id) do nothing;

-- Nadie fuera de las funciones puede tocar estas tablas.
revoke all on schema core from public, anon, authenticated;
revoke all on all tables in schema core from public, anon, authenticated;
revoke all on all functions in schema core from public, anon, authenticated;
