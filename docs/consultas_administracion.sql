-- Prodmazul · Consultas de administración (Parte 1)
-- Se ejecutan en Supabase > SQL Editor > New query.
-- IMPORTANTE: pega y ejecuta UNA consulta a la vez, después de reemplazar los valores entre comillas simples.
-- Todas terminan con RETURNING para que el resultado muestre exactamente qué fila cambió.

-- ------------------------------------------------------------------ 1. VER USUARIOS, ESTADO Y ROL
select p.correo, p.nombre, p.activo, p.es_admin_general,
       coalesce(u.modulo_id, '(sin módulo)') as modulo, coalesce(u.rol_id, '(sin rol)') as rol
from core.perfiles p
left join core.usuario_modulo_rol u on u.user_id = p.user_id
order by p.correo;

-- ------------------------------------------------------------------ 2. CONVERTIR A ADMINISTRADOR GENERAL
-- Reemplaza CORREO_DEL_ADMINISTRADOR y NOMBRE_COMPLETO.
update core.perfiles
set es_admin_general = true, nombre = 'NOMBRE_COMPLETO'
where correo = 'CORREO_DEL_ADMINISTRADOR'
returning correo, nombre, es_admin_general, activo;

-- ------------------------------------------------------------------ 3. CAMBIAR EL NOMBRE DE UN USUARIO
update core.perfiles
set nombre = 'NOMBRE_COMPLETO'
where correo = 'CORREO_DEL_USUARIO'
returning correo, nombre;

-- ------------------------------------------------------------------ 4. ASIGNAR O CAMBIAR EL ROL EN EL MÓDULO M01
-- Roles válidos: 'operativo', 'consulta', 'admin_modulo'.
insert into core.usuario_modulo_rol (user_id, modulo_id, rol_id)
select user_id, 'M01', 'ROL'
from core.perfiles
where correo = 'CORREO_DEL_USUARIO'
on conflict (user_id, modulo_id) do update set rol_id = excluded.rol_id
returning user_id, modulo_id, rol_id;

-- ------------------------------------------------------------------ 5. QUITAR EL ACCESO A UN MÓDULO
delete from core.usuario_modulo_rol
where modulo_id = 'M01'
  and user_id = (select user_id from core.perfiles where correo = 'CORREO_DEL_USUARIO')
returning user_id, modulo_id, rol_id;

-- ------------------------------------------------------------------ 6. DESACTIVAR A UN USUARIO
-- No podrá usar la aplicación (la base de datos le niega todo). Su historial se conserva.
update core.perfiles
set activo = false
where correo = 'CORREO_DEL_USUARIO'
returning correo, activo;

-- ------------------------------------------------------------------ 7. REACTIVAR A UN USUARIO
update core.perfiles
set activo = true
where correo = 'CORREO_DEL_USUARIO'
returning correo, activo;

-- ------------------------------------------------------------------ 8. CAMBIAR LA CONTRASEÑA DE UN USUARIO (sin correo)
-- La clave temporal queda en el historial del editor: bórrala de «Query history» después.
-- Pide al usuario que la cambie al entrar (menú «Cambiar mi contraseña»).
update auth.users
set encrypted_password = extensions.crypt('CLAVE_TEMPORAL', extensions.gen_salt('bf')),
    updated_at = now()
where email = 'CORREO_DEL_USUARIO'
returning email, updated_at;

-- ------------------------------------------------------------------ 9. VER LA AUDITORÍA RECIENTE
select a.creado_en, p.correo as usuario, a.modulo_id, a.accion, a.entidad, a.entidad_id, a.resultado
from core.auditoria a
left join core.perfiles p on p.user_id = a.user_id
order by a.evento_id desc
limit 50;
