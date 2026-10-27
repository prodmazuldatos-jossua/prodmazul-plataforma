# Prodmazul · Manual breve del administrador · Módulo 1: Recepción

**Para quién es:** la persona responsable de la plataforma (cuentas, permisos, copias de seguridad).
**Qué vas a poder hacer:** crear y desactivar usuarios desde la aplicación, asignar roles, cambiar contraseñas, anular/eliminar/reactivar recepciones, reabrir lotes, ver la auditoría, vigilar el respaldo en Google, ajustar la configuración, unir proveedores o especies repetidos y mantener copias que **sí se pueden restaurar**.
**Tiempo de lectura:** 35 minutos.

> **Regla de oro.** Contraseñas, claves (`service_role`, contraseña de la base de datos) y tokens **nunca** se escriben en el chat, en el código, en Git, ni se mandan por correo o mensaje. Guárdalas en tu gestor de contraseñas (Bitwarden).

> **Cómo leer las consultas SQL.** Se ejecutan en **Supabase > SQL Editor > New query**. Pega **una consulta a la vez**, reemplaza lo que está en MAYÚSCULAS entre comillas simples (`'CORREO_DEL_USUARIO'`), presiona **Run** y comprueba el resultado. Los archivos están en la carpeta `docs\` del repositorio, `consultas_administracion.sql` es el principal.

---

## 1. Qué hay y dónde

| Pieza | Para qué sirve | Dónde se administra |
|---|---|---|
| **Aplicación** (la que usan los operadores) | Registrar recepciones | Se publica sola al hacer `git push` (Cloudflare Pages) |
| **Supabase** | Base de datos, inicio de sesión y fotos | supabase.com > tu proyecto |
| **GitHub** | Guarda el código y dispara la publicación | github.com > tu repositorio |
| **Tu PC** (`C:\Proyectos\prodmazul-plataforma`) | Código, copias de seguridad y pruebas locales | Carpeta del repositorio |
| **Google (cuenta DATOS)** | Espejo de solo lectura en **Sheets** (un libro por año) y copia de las **fotos** en **Drive** | Menú > **Estado del respaldo** |
| **Pantallas de administración** | Usuarios, Configuración, Auditoría, Lotes, Catálogo y Estado del respaldo | Menú de la aplicación (solo con permiso de administración) |

---

## 2. Roles y permisos

Cada persona tiene **un rol por módulo**. Los módulos que no tiene asignados **no los ve**.

| Rol | Qué puede hacer en Recepción |
|---|---|
| **operativo** | Ver, crear recepciones, **editar y anular las suyas**, cargar fotos |
| **consulta** | Solo **ver** (listado, detalle, PDF) |
| **admin_modulo** | Todo lo anterior **sobre cualquier recepción**, además de **eliminar y reactivar** |
| **Administrador general** (marca aparte) | Entra a todos los módulos con permisos de administración |

---

## 3. Crear un usuario nuevo

1. Supabase > **Authentication** > **Users** > **Add user** > **Create new user**.
2. **Email address:** el correo de la persona. **Password:** genérala en tu gestor (mínimo 10 caracteres). **Marca «Auto Confirm User»** (si no, no podrá entrar: «Email not confirmed»). **Create user**.
3. **Nombre** (sale en «Hola, Nombre» y en «Realizado por» del PDF):

```sql
update core.perfiles
set nombre = 'NOMBRE_COMPLETO'
where correo = 'CORREO_DEL_USUARIO'
returning correo, nombre;
```

4. **Rol** en el módulo (`operativo`, `consulta` o `admin_modulo`):

```sql
insert into core.usuario_modulo_rol (user_id, modulo_id, rol_id)
select user_id, 'M01', 'ROL'
from core.perfiles
where correo = 'CORREO_DEL_USUARIO'
on conflict (user_id, modulo_id) do update set rol_id = excluded.rol_id
returning user_id, modulo_id, rol_id;
```

5. Entrega la contraseña **en persona** o por un canal privado, y pídele que la cambie al entrar (menú **Cambiar mi contraseña**).

**Comprobación:** inicia sesión con ese usuario (ventana privada): ve «Hola, Nombre» y el módulo correcto.

---

## 4. Ver, cambiar y quitar permisos

**Ver todos los usuarios, estado y rol:**

```sql
select p.correo, p.nombre, p.activo, p.es_admin_general,
       coalesce(u.modulo_id, '(sin módulo)') as modulo, coalesce(u.rol_id, '(sin rol)') as rol
from core.perfiles p
left join core.usuario_modulo_rol u on u.user_id = p.user_id
order by p.correo;
```

**Cambiar el rol:** repite la consulta del paso 3.4 con el rol nuevo.

**Quitar el acceso al módulo:**

```sql
delete from core.usuario_modulo_rol
where modulo_id = 'M01'
  and user_id = (select user_id from core.perfiles where correo = 'CORREO_DEL_USUARIO')
returning user_id, modulo_id, rol_id;
```

---

## 5. Desactivar y reactivar a una persona

Cuando alguien deja de trabajar con el sistema. **Su historial se conserva** y no podrá usar la aplicación (la base de datos le niega todo, aunque tenga la contraseña).

```sql
update core.perfiles set activo = false where correo = 'CORREO_DEL_USUARIO' returning correo, activo;
```

Para reactivar, la misma consulta con `activo = true`. **No borres** al usuario desde Authentication: perderías la relación con lo que registró.

---

## 6. Cambiar la contraseña de un usuario

No se usa recuperación por correo: **tú la cambias**.

```sql
update auth.users
set encrypted_password = extensions.crypt('CLAVE_TEMPORAL', extensions.gen_salt('bf')),
    updated_at = now()
where email = 'CORREO_DEL_USUARIO'
returning email, updated_at;
```

1. Genera la `CLAVE_TEMPORAL` en tu gestor de contraseñas.
2. Después de ejecutar, **borra la clave del historial**: en el SQL Editor abre **Query history** y elimina esa consulta.
3. Entrega la clave temporal en persona y pide que la cambie al entrar.

---

## 7. Anular, eliminar y reactivar recepciones

Ninguna recepción se borra del todo: **cambia de estado** y deja de contar en los reportes.

| Estado | Qué significa | Quién lo pone | Cómo se ve |
|---|---|---|---|
| **Borrador** | Incompleta; se puede terminar | El operador | Se puede editar |
| **Cerrada** | Completa | El operador | Se puede editar y anular |
| **Anulada** | Anulada con un **motivo**; queda visible en «Anuladas» | El autor o el administrador | Marca **ANULADA** en el PDF |
| **Eliminada** | Oculta de los listados normales | **Solo el administrador** | Solo la ve el administrador (filtro **Todas**, y **Eliminadas** si tu pantalla lo ofrece) |

**Desde la aplicación** (inicia sesión como administrador): abre la recepción > botones **Anular**, **Eliminar** o **Reactivar** > escribe el **motivo** (de 5 a 500 caracteres) > confirma. **Reactivar** devuelve la recepción al estado que tenía antes. Estas acciones **necesitan señal**.

**Todo queda en la auditoría** (sección 9): quién, cuándo y por qué.

### Reabrir un lote cerrado

Un lote cerrado no admite camiones nuevos. Si se cerró por error, **desde la aplicación**: menú > **Lotes** > busca el lote > **Reabrir** > escribe el **motivo** > confirma. Queda en la auditoría.

Alternativa por consulta (si la pantalla no estuviera disponible):

1. Abre `docs\reabrir_lote.sql`, reemplaza `LOTE_A_REABRIR` (aparece **dos veces**) por el lote, por ejemplo `123-456-789`.
2. Pégalo completo en el SQL Editor > **Run**.

**Comprobación:** devuelve una fila con `cerrado = false`.

### Borrar datos de prueba (solo pruebas)

`docs\limpiar_recepcion.sql` borra definitivamente una recepción de **prueba** por su guía. **Nunca** lo uses con recepciones reales. Las fotos se borran aparte en **Storage > m01-recepcion-fotos**.

---

## 8. Copias de seguridad

### 8.1. Qué guarda la copia diaria

| Archivo (en `backups\`) | Contenido |
|---|---|
| `esquema-FECHA.sql` | La estructura de la base de datos |
| `datos-FECHA.sql` | Usuarios, roles, lotes, proveedores, auditoría **y todas las recepciones** |
| `cuentas-FECHA.sql` | Las cuentas de acceso (correos y contraseñas cifradas) |

**No incluye las fotos**: viven en Supabase y, además, se copian solas a **Drive** (sección 13). Las **recepciones** también están en el espejo de Sheets, pero Sheets **no es el sistema principal** y no guarda el contador de numeración: la copia diaria sigue siendo tu respaldo principal.

### 8.2. Cómo hacerla

1. Abre **Docker Desktop** y espera **Engine running**.
2. En PowerShell:

```powershell
cd C:\Proyectos\prodmazul-plataforma
powershell.exe -ExecutionPolicy Bypass -File .\respaldo-diario.ps1
```

**Resultado esperado:** los tres archivos con **Length mayor a 0** y el mensaje verde **«Comprobado: la copia incluye las recepciones»**. Si aparece **ATENCION** en rojo, la copia no sirve: revisa que estés usando el script de la Parte 12.

> Haz la copia **cada día de trabajo** (puedes programarla en el Programador de tareas de Windows).

### 8.3. Dónde guardarlas

La carpeta `backups\` **no se sube a Git** (a propósito: tiene datos y cuentas). Copia cada semana la carpeta a un lugar **fuera de tu PC**: disco externo o un Drive privado. Conserva **al menos las últimas 30 copias**.

### 8.4. Probar que una copia sirve (hazlo una vez al mes)

Una copia que nunca se restauró no es una garantía. La prueba se hace **en tu PC**, sin tocar el proyecto real:

1. Docker Desktop abierto. En PowerShell:

```powershell
cd C:\Proyectos\prodmazul-plataforma
npx supabase start
```

2. Restaura la copia de una fecha:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\restaurar-copia-local.ps1 -Fecha 2026-10-26
```

3. **Resultado esperado:** al final verás una tabla con la cantidad de recepciones, gavetas, usuarios, lotes… y las **5 recepciones más recientes**. Compara con lo que tienes en Supabase (**Table Editor** o `select count(*) from m01_recepcion.recepciones;`). Deben ser iguales al día de la copia.
4. Cuando termines: `npx supabase stop`.

> **Importante:** el script **vacía la base LOCAL** antes de restaurar. **Nunca** lo apuntes al proyecto real; solo habla con el contenedor de Docker de tu PC.

### 8.5. Si algún día hay que recuperar el proyecto real

1. **No improvises ni borres nada.** Avísame con el mensaje de error y la fecha de la última copia buena.
2. El camino general es: crear un proyecto nuevo en Supabase > aplicar las migraciones del repositorio (`npx supabase db push`) > cargar `cuentas-FECHA.sql` y `datos-FECHA.sql` > cambiar `.env.local` y las variables de Cloudflare a la URL y clave del proyecto nuevo > crear de nuevo el bucket de fotos con `db push` (ya viene en las migraciones).
3. Lo que se pierde: lo registrado **después** de la última copia (o del último envío a Sheets). Las **fotos** se recuperan de Drive (sección 14).

---

## 9. Ver la auditoría

**Desde la aplicación:** menú > **Auditoría**. Filtra por fecha, persona, acción o recepción; muestra 30 por página. Es de solo lectura.

Por consulta (las 50 acciones más recientes):

```sql
select a.creado_en, p.correo as usuario, a.modulo_id, a.accion, a.entidad, a.entidad_id, a.resultado
from core.auditoria a
left join core.perfiles p on p.user_id = a.user_id
order by a.evento_id desc
limit 50;
```

La auditoría **no se puede modificar ni borrar** (la base de datos lo impide).

---

## 10. Revisión mensual de seguridad (10 minutos)

1. **Base de datos:** pega `docs\revision_seguridad_parte12.sql` en el SQL Editor > **Run**. Todas las filas deben decir **CORRECTO**.
2. **Desde fuera:** en PowerShell, `powershell.exe -ExecutionPolicy Bypass -File .\docs\revision_acceso_anonimo_parte12.ps1` (te pide la URL, la clave **pública** y la dirección del sitio). Debe terminar con **0 con fallo**.
3. **Supabase > Advisors > Security Advisor:** no deben aparecer errores en rojo (los avisos amarillos se me envían para revisarlos).
4. **Revisión ampliada (Fase 5):** pega `docs\revision_seguridad_f5.sql` en el SQL Editor > **Run**. Es de solo lectura, no muestra valores de secretos y debe dejar **todas las filas en OK**; ninguna en **CRITICO**.
5. **Usuarios:** desde la pantalla **Usuarios** (o con la consulta de la sección 4), revisa que solo estén activos quienes siguen trabajando.

---

## 11. Actualizar la aplicación

Cuando yo te entregue una parte nueva: **copia de seguridad primero** (sección 8.2) > copiar los archivos > pruebas (`npm run test`, `npm run build`) > `git add .`, `git commit`, `git push` > esperar **Success** en Cloudflare (1 a 3 minutos). Los operadores ven la versión nueva al **abrir la aplicación con señal**.

---

## 12. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Una persona no puede entrar: «Correo o contraseña incorrectos» | Contraseña mal o usuario sin confirmar | Cambia la contraseña (sección 6); revisa **Auto Confirm** en Authentication |
| Entra pero no ve el módulo | Sin rol asignado | Sección 3.4 |
| «Tu cuenta está desactivada» | `activo = false` | Sección 5 |
| Un operador no puede registrar: «lote cerrado» | Se cerró el lote | Reabrirlo (sección 7) |
| Un operador no puede anular/editar una recepción | No es suya | Hazlo tú, o cámbiale el rol a `admin_modulo` si corresponde |
| El respaldo falla con «password authentication failed» | La variable `SUPABASE_DB_PASSWORD` está mal | Vuelve a definirla con la contraseña de la base (nunca en el chat) |
| El respaldo falla por Docker | Docker Desktop cerrado | Ábrelo y espera **Engine running** |
| Un operador dice que «desaparecieron» recepciones pendientes | Se borraron los datos del navegador antes de enviarlas | Pídele que las registre de nuevo; explica la regla del manual del operador |
| El sitio muestra la versión vieja | Caché | **Ctrl + F5** o actualizar la aplicación con señal |

---

## 13. Respaldo en Google (Sheets y Drive)

Menú > **Estado del respaldo** muestra cuándo fue el último envío, cuántos registros esperan y si hubo errores. Cada **2 horas** el sistema envía los cambios a un libro de **Sheets por año** (11 hojas: proveedores, especies, lotes, perfiles, usuario_modulo_rol, config, recepciones, recepcion_gavetas, recepcion_temperaturas, recepcion_almacenamiento y fotos_meta). Las fotos se copian a **Drive** en `Prodmazul_Respaldo_Fotos/M01_Recepcion/AAAA/MM/REC-…/foto_NN.ext`.

- **Sheets es un espejo de solo lectura.** Nunca edites ahí: lo que cambies se pisa en el próximo envío y **no vuelve** a Supabase.
- Si pasan más de **6 horas** sin sincronizar (parámetro `sync_alerta_horas`), la pantalla lo avisa en rojo.
- **Las fotos se borran de Supabase a los 60 días** solo si tienen **copia confirmada en Drive** y la purga está encendida. **No la enciendas** hasta que el receptor responda versión **2.2** (`ping`).
- No hay correos de aviso: la alerta se ve en la aplicación.

## 14. Restaurar desde Google o desde la copia local

**Siempre se prueba primero en tu PC (Docker local), nunca en el proyecto real.** La guía de la Parte 11 trae el paso a paso.

| Si pasó… | Qué usar | Resultado |
|---|---|---|
| Se perdieron datos y Supabase no tiene copia | Descargar cada hoja del libro de Sheets como **CSV** y ejecutar `node herramientas/restaurar-desde-sheets.mjs --carpeta <carpeta con los CSV>`; luego aplicar el `restauracion.sql` generado | Reaparecen proveedores, especies, lotes, recepciones, gavetas, temperaturas, almacenamiento y fotos_meta; la numeración continúa |
| Faltan las fotos | Descargar la carpeta `M01_Recepcion` de Drive y ejecutar `node herramientas/restaurar-fotos.mjs --fotos-meta <fotos_meta.csv> --carpeta <carpeta>` (la clave de servicio va en una variable de entorno, **nunca** en el chat) | Las fotos vuelven al almacenamiento y se quita la marca de «purgada» |
| Necesitas el estado de un día concreto | `restaurar-copia-local.ps1 -Fecha AAAA-MM-DD` (copia diaria, solo en la base **local**) | Datos de ese día en Docker, para consultar o comparar |

Límites: las cuentas de acceso deben existir antes (se restauran desde `cuentas-FECHA.sql`); por defecto no se restauran usuarios ni configuración (opciones `--incluir-usuarios` y `--incluir-config`); repetir la restauración **no duplica** nada.

## 15. Configuración, catálogo y usuarios (pantallas)

- **Configuración** (menú): solo 8 parámetros, cada uno con límites: días de retención de fotos (7–3650), horas de gracia de la purga (1–720), máximo por corrida de purga (1–1000), factor libras→kg (2,2–2,21), máximo de fotos por recepción (1–20), formato del lote, horas de alerta de sincronización (1–168) y días de historial de envíos (1–365). Cada cambio queda en la auditoría.
- **Catálogo:** si hay proveedores o especies repetidos (por ejemplo «Mar Azul» y «MarAzul»), usa **Unir**: el nombre que sobra pasa a ser un **alias**, las recepciones y lotes pasan al nombre que queda, y la acción se audita. **No se deshace** desde la pantalla.
- **Usuarios:** crear, cambiar rol, desactivar/reactivar y cambiar contraseña desde la aplicación (la contraseña **nunca** se muestra ni se guarda en el historial). Las consultas de las secciones 3 a 6 quedan como alternativa.

## 16. Plan Pro de Supabase y almacenamiento de la cuenta DATOS

- **Plan gratuito:** sin copias automáticas y el proyecto se **pausa tras 1 semana sin actividad**. **Pro** (desde unos 25 USD al mes) agrega copias diarias de 7 días y no se pausa. La recuperación a un punto exacto (PITR) es un **extra de pago**.
- **Cuenta DATOS (Google):** cuando Drive se acerque a su límite, contrata **Google One** o **Workspace**. El precio depende de tu país: **lee el que te muestra tu pantalla de compra**.
- Pasar a Pro **no cambia** URL, claves ni datos. Después del cambio, revisa **Estado del respaldo** y la revisión de seguridad.
