-- Prodmazul · Fase 4 · Parte 2 · Migración 4: módulo 1, Recepción (esquema m01_recepcion)
-- Todos los pesos se guardan en LIBRAS. Los kilos se calculan al mostrar.

create schema if not exists m01_recepcion;

create table m01_recepcion.contadores (
  fecha  date primary key,
  ultimo integer not null default 0
);

create table m01_recepcion.recepciones (
  recepcion_id          text primary key,
  client_uuid           uuid not null,
  fecha_llegada         date not null,
  placa_vehiculo        text,
  lote_id               text not null references core.lotes (lote_id),
  proveedor_id          uuid not null references core.proveedores (id),
  especie_id            uuid not null references core.especies (id),
  piscina               text,
  guia_remision         text not null,
  num_gavetas_bines     integer not null,
  libras_reportadas     numeric(12,2),
  libras_planta         numeric(12,2),
  peso_promedio_lb      numeric(10,2),
  diferencia_lb         numeric(12,2) generated always as (libras_planta - libras_reportadas) stored,
  diferencia_pct        numeric(8,2) generated always as (
                          case when libras_reportadas > 0
                               then round(((libras_planta - libras_reportadas) / libras_reportadas * 100)::numeric, 2)
                          end) stored,
  hora_inicio_descarga  time,
  hora_fin_descarga     time,
  duracion_descarga_min integer generated always as (
                          case when hora_inicio_descarga is not null and hora_fin_descarga is not null
                               then (extract(epoch from (hora_fin_descarga - hora_inicio_descarga)) / 60)::integer
                          end) stored,
  observacion           text,
  realizado_por         uuid references core.perfiles (user_id),
  revisado_por          uuid references core.perfiles (user_id),
  estado                text not null default 'borrador',
  estado_previo         text,
  motivo_anulacion      text,
  anulado_por           uuid,
  anulado_en            timestamptz,
  eliminado_por         uuid,
  eliminado_en          timestamptz,
  version               integer not null default 1,
  creado_en             timestamptz not null default now(),
  creado_por            uuid,
  modificado_en         timestamptz not null default now(),
  modificado_por        uuid,
  constraint recepciones_id_chk check (recepcion_id ~ '^REC-[0-9]{8}-[0-9]{4,}$'),
  constraint recepciones_client_uuid_key unique (client_uuid),
  constraint recepciones_guia_key unique (guia_remision),
  constraint recepciones_estado_chk check (estado in ('borrador', 'cerrado', 'anulado', 'eliminado')),
  constraint recepciones_gavetas_chk check (num_gavetas_bines >= 1),
  constraint recepciones_lbs_rep_chk check (libras_reportadas is null or libras_reportadas > 0),
  constraint recepciones_lbs_pla_chk check (libras_planta is null or libras_planta > 0),
  constraint recepciones_horas_chk check (
    hora_inicio_descarga is null or hora_fin_descarga is null or hora_fin_descarga >= hora_inicio_descarga),
  constraint recepciones_obs_chk check (observacion is null or char_length(observacion) <= 2000),
  constraint recepciones_motivo_chk check (estado <> 'anulado' or char_length(btrim(coalesce(motivo_anulacion, ''))) >= 5)
);
create index recepciones_fecha_idx on m01_recepcion.recepciones (fecha_llegada desc);
create index recepciones_lote_idx on m01_recepcion.recepciones (lote_id);
create index recepciones_proveedor_idx on m01_recepcion.recepciones (proveedor_id);
create index recepciones_estado_idx on m01_recepcion.recepciones (estado);

create table m01_recepcion.recepcion_gavetas (
  recepcion_id text not null references m01_recepcion.recepciones (recepcion_id) on delete cascade,
  num_gaveta   smallint not null check (num_gaveta between 1 and 30),
  peso_lb      numeric(10,2) not null check (peso_lb > 0),
  primary key (recepcion_id, num_gaveta)
);

create table m01_recepcion.recepcion_temperaturas (
  recepcion_id  text not null references m01_recepcion.recepciones (recepcion_id) on delete cascade,
  lectura_id    smallint not null check (lectura_id between 1 and 6),
  bines         text not null,
  temperatura_c numeric(5,1) not null,
  primary key (recepcion_id, lectura_id)
);

create table m01_recepcion.recepcion_almacenamiento (
  recepcion_id          text not null references m01_recepcion.recepciones (recepcion_id) on delete cascade,
  num_bin               text not null check (btrim(num_bin) <> ''),
  sellos_recepcion      text not null default '',
  sellos_almacenamiento text not null default '',
  temperatura_c         numeric(5,1),
  libras_aprox          numeric(12,2) check (libras_aprox is null or libras_aprox > 0),
  primary key (recepcion_id, num_bin)
);
create unique index almacenamiento_sello_rec_uk
  on m01_recepcion.recepcion_almacenamiento (recepcion_id, sellos_recepcion) where sellos_recepcion <> '';
create unique index almacenamiento_sello_alm_uk
  on m01_recepcion.recepcion_almacenamiento (recepcion_id, sellos_almacenamiento) where sellos_almacenamiento <> '';

create table m01_recepcion.fotos_meta (
  foto_id             text primary key,
  recepcion_id        text not null references m01_recepcion.recepciones (recepcion_id) on delete cascade,
  modulo_id           text not null default 'M01',
  lote_id             text not null,
  nn                  smallint not null check (nn between 1 and 5),
  ruta                text not null unique,
  nombre              text not null,
  tipo_mime           text not null check (tipo_mime in ('image/jpeg', 'image/png', 'image/webp')),
  tamano_bytes        integer not null check (tamano_bytes > 0 and tamano_bytes <= 5242880),
  subido_por          uuid,
  subido_en           timestamptz not null default now(),
  confirmada          boolean not null default false,
  drive_file_id       text,
  respaldo_drive_en   timestamptz,
  purgada_supabase_en timestamptz,
  unique (recepcion_id, nn)
);

alter table m01_recepcion.contadores               enable row level security;
alter table m01_recepcion.recepciones              enable row level security;
alter table m01_recepcion.recepcion_gavetas        enable row level security;
alter table m01_recepcion.recepcion_temperaturas   enable row level security;
alter table m01_recepcion.recepcion_almacenamiento enable row level security;
alter table m01_recepcion.fotos_meta               enable row level security;

-- Identificador REC-AAAAMMDD-#### (seguro ante concurrencia).
create function m01_recepcion.siguiente_id(p_fecha date) returns text
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into m01_recepcion.contadores (fecha, ultimo) values (p_fecha, 1)
  on conflict (fecha) do update set ultimo = m01_recepcion.contadores.ultimo + 1
  returning ultimo into n;
  return 'REC-' || to_char(p_fecha, 'YYYYMMDD') || '-' || lpad(n::text, 4, '0');
end $$;

-- Respaldo del límite de fotos por recepción (el límite real está en core.config).
create function m01_recepcion.limitar_fotos() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_max integer;
  v_act integer;
begin
  select coalesce((valor #>> '{}')::integer, 5) into v_max from core.config where clave = 'max_fotos_recepcion';
  select count(*) into v_act from m01_recepcion.fotos_meta where recepcion_id = new.recepcion_id;
  if v_act >= coalesce(v_max, 5) then
    raise exception 'E_FOTOS|Cada recepción admite como máximo % fotos.', coalesce(v_max, 5);
  end if;
  return new;
end $$;

create trigger fotos_limite before insert on m01_recepcion.fotos_meta
  for each row execute function m01_recepcion.limitar_fotos();

-- Los datos que identifican a la recepción no se pueden cambiar después de creada.
create function m01_recepcion.proteger_inmutables() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.recepcion_id is distinct from old.recepcion_id
     or new.client_uuid is distinct from old.client_uuid
     or new.creado_en is distinct from old.creado_en
     or new.creado_por is distinct from old.creado_por then
    raise exception 'E_VALIDACION|El identificador y los datos de creación de una recepción no se pueden cambiar.';
  end if;
  return new;
end $$;

create trigger recepciones_inmutables before update on m01_recepcion.recepciones
  for each row execute function m01_recepcion.proteger_inmutables();

-- Las recepciones NO se borran: se anulan o se eliminan (cambio de estado).
-- Excepción para el administrador de la base de datos (por ejemplo, limpiar datos de prueba):
--   begin; set local prodmazul.permitir_borrado = 'si'; delete from ...; commit;
create function m01_recepcion.bloquear_borrado() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('prodmazul.permitir_borrado', true), '') <> 'si' then
    raise exception 'E_ESTADO|Las recepciones no se borran: se anulan o se eliminan (cambio de estado).';
  end if;
  return old;
end $$;

create trigger recepciones_sin_borrado before delete on m01_recepcion.recepciones
  for each row execute function m01_recepcion.bloquear_borrado();

revoke all on schema m01_recepcion from public, anon, authenticated;
revoke all on all tables in schema m01_recepcion from public, anon, authenticated;
revoke all on all functions in schema m01_recepcion from public, anon, authenticated;
