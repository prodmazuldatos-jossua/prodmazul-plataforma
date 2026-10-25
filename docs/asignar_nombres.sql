-- Prodmazul · Fase 4 · Parte 7 · Asignar el NOMBRE de cada usuario
-- Cómo usarlo: Supabase > SQL Editor > New query > pega este archivo, CAMBIA los correos y los nombres por los reales > Run.
-- El nombre se muestra en el saludo «Hola, Nombre» y en «Realizado por» del PDF (Parte 11).
-- Escribe el nombre tal como quieres que se vea: por ejemplo Pedro, Luis o Xavier (hasta 60 caracteres).
-- Se puede ejecutar de nuevo para corregir un nombre. Si el correo no existe, muestra un error y no cambia nada.

select core.asignar_nombre_usuario('prodmazul.datos@gmail.com', 'Henry Salazar');
select core.asignar_nombre_usuario('recepcion@prodmazul.com', 'Luis Chavez');

-- Para ver cómo quedaron todos los usuarios:
select correo, nombre, activo, es_admin_general from core.perfiles order by nombre, correo;
