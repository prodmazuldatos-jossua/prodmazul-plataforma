# Prodmazul · Manual del usuario operador · Módulo 1: Recepción

**Para quién es:** la persona que recibe la materia prima y registra cada llegada en la tablet.
**Qué vas a aprender:** entrar, registrar una recepción completa, buscar y revisar lo registrado, descargar e imprimir el PDF para firmar, y qué hacer cuando **se va la señal**.
**Tiempo de lectura:** 20 minutos. Después de leerlo, haz una recepción de práctica con tu administrador.

> **Tres reglas que conviene recordar siempre**
> 1. Tu contraseña es personal: **no la compartas** ni la anotes en la tablet.
> 2. Revisa los números **antes de tocar «Guardar y cerrar»**: una recepción cerrada solo se corrige con **Editar** o se **anula**, nunca se borra.
> 3. Si ves **«Sin conexión»**, sigue trabajando: lo que registres **se guarda en la tablet y se envía solo** cuando vuelva la señal.

---

## 1. Entrar y salir

1. Abre la aplicación **Prodmazul** (el ícono con el logotipo, o la dirección que te dio el administrador, en Chrome).
2. Escribe tu **Correo** y tu **Contraseña** y toca **Iniciar sesión**.

{{img:login|Pantalla de inicio de sesión}}

3. Verás el **Inicio** con el saludo **«Hola, tu nombre»** y una tarjeta por cada módulo al que tienes acceso (**Módulo 1: Recepción**). Si no ves ningún módulo, avisa al administrador.

{{img:inicio|Pantalla de inicio}}

**Para salir:** toca **Cerrar sesión** (abajo del menú de la izquierda, o en el menú de la parte superior si usas teléfono). Si tienes recepciones pendientes de enviar, la aplicación te lo recuerda antes de salir.

**Si olvidaste tu contraseña:** pide al administrador que te la cambie. **Para cambiarla tú:** menú **Cambiar mi contraseña** > escribe la actual, la nueva dos veces > guarda.

---

## 2. Conoce la pantalla

| Parte | Qué hace |
|---|---|
| **Menú de la izquierda** | **Inicio**, **Recepción**, **Cambiar mi contraseña** y **Cerrar sesión**. Abajo ves tu nombre |
| **«En línea» / «Sin conexión»** (arriba) | Te dice si hay señal. Con punto verde todo se envía al instante |
| **Chip amarillo «1 pendiente»** | Aparece solo cuando hay recepciones guardadas en la tablet que aún no se enviaron (sección 8) |
| **Interruptor Lb / Kg** (arriba a la derecha) | Cambia **cómo ves** los pesos. Tú siempre puedes escribir en la unidad que tengas marcada; la aplicación hace la conversión sola |

{{img:interruptor|Interruptor de libras y kilos}}

---

## 3. Registrar una recepción nueva

En **Recepción** toca **Nueva recepción**. El formulario tiene **5 secciones** (los botones de arriba, **1 Datos · 2 Gavetas · 3 Temperaturas · 4 Almacenamiento · 5 Cierre**, te llevan a cada una). Los campos con **asterisco rojo (\*)** son obligatorios.

{{img:form_arriba|Formulario: sección 1, datos generales}}

### 3.1. Datos generales

| Campo | Cómo llenarlo |
|---|---|
| **Fecha de llegada \*** | Viene con la fecha de hoy. No puede ser futura |
| **Placa del vehículo** | Placa del camión |
| **Lote \*** | **Tres grupos separados por guion**, por ejemplo `123-456-789` o `123-456A-789`. Si el lote ya existe, la aplicación avisa **«Lote existente»** y cuántos camiones lleva ya registrados; si el lote está **cerrado**, te lo dice en rojo |
| **Proveedor \*** | Empieza a escribir y elige de la lista. Si es nuevo, escríbelo completo |
| **Especie \*** | Igual que el proveedor |
| **Piscina** | Número o nombre de la piscina |
| **Guía de remisión \*** | No se puede repetir: si ya existe, la aplicación avisa **«Ya existe una recepción con esa guía de remisión»** |
| **El producto llegó en** | **Bines** (lo normal) o **Gavetas** |
| **N.º de gavetas o bines \*** | La cantidad que **llegó**, como dice la guía. Es solo informativa: **no tiene que coincidir** con las gavetas que pesas |
| **Peso reportado / Peso planta** | El peso que dice el proveedor y el que marca la báscula de planta. Se escriben en la unidad marcada arriba (Lb o Kg) |
| **Hora de inicio / fin de descarga** | La de fin no puede ser anterior a la de inicio |

### 3.2. Gavetas (sección 2)

Se pesa **una muestra** de gavetas (hasta **30**) para sacar el **peso promedio**. El peso de las gavetas es **opcional**. Al empezar ves **2 casillas**; si pesaste más, toca **+ Agregar gaveta** y aparece **una casilla más** (hasta 30). Con **Enter** pasas a la siguiente. Las casillas se reparten en grupos de 10 (**1-10, 11-20, 21-30**) y cada grupo aparece solo cuando lo necesitas. Con **Quitar la última gaveta** deshaces la última casilla si está vacía.

- Debajo de cada grupo de 10 verás su **Peso promedio**.
- Abajo ves **cuántas gavetas pesaste** y su **peso total**.
- Los datos de **Cálculos** (diferencia entre planta y reportado, promedio general) se actualizan solos.

### 3.3. Temperaturas (sección 3)

Es la temperatura de **algunas gavetas** (por defecto hay **2 filas**). En cada fila: elige la **gaveta** (salen las que ves en la sección 2, tengan peso o no) y escribe la **temperatura en °C**. Para temperaturas **bajo cero** toca el botón **±**. Si necesitas más filas, toca **+ Agregar temperatura**; con **Quitar esta fila** eliminas una.

### 3.4. Almacenamiento (sección 4)

Una fila por **bin**: **N.º de bin**, **sello de recepción**, **sello de almacenamiento**, **temperatura** y **libras aproximadas**. Toca **+ Agregar bin** para más filas. Ni los números de bin ni los sellos se pueden repetir en la misma recepción. Las filas vacías se ignoran, y abajo ves las **libras aproximadas en total**.

### 3.5. Cierre (sección 5)

{{img:form_cierre|Formulario: sección 5, cierre}}

| Elemento | Qué es |
|---|---|
| **Observación** | Cualquier detalle de la llegada (máximo 2000 caracteres) |
| **¿Llegan más camiones con este lote?** | **Lote abierto** (vienen más camiones; es lo normal) o **Cerrar lote** (este es el último). Un lote cerrado **ya no admite recepciones nuevas**; si te equivocas, pide al administrador que lo reabra |
| **Realizado por** | Sale tu nombre automáticamente. No se cambia |
| **Fotos de la recepción** | Hasta **5**. **Tomar foto** usa la cámara; **Elegir de la galería** usa fotos ya tomadas. Se reducen solas y se suben al guardar |

### 3.6. Guardar

| Botón | Cuándo usarlo |
|---|---|
| **Guardar borrador** | Si todavía te falta información. Un borrador **nunca cierra el lote** y se puede completar después |
| **Guardar y cerrar** | Cuando terminaste. Para cerrar se exige además: **peso reportado** y **peso planta** (el peso de las gavetas ya no es obligatorio) |
| **Salir** | Sales del formulario. Si hay cambios sin guardar, la aplicación **pregunta** antes de perderlos |

Si falta algo, la aplicación **te lo marca en rojo** junto al campo y te lleva a él. Cuando todo está bien, al presionar **Guardar borrador** o **Guardar y cerrar** la aplicación te **lleva al listado de recepciones** con un aviso verde: busca ahí tu recepción (con su número de **guía**) para comprobar que quedó guardada. Si no había señal, el aviso te dice que quedó **en la tablet** y se enviará sola.

---

## 4. Buscar y revisar recepciones

En **Recepción** ves el listado.

{{img:lista|Listado de recepciones}}

- **Buscar:** escribe parte del número de recepción, la guía, el lote, la placa, el proveedor o la especie.
- **Guía:** el número de guía de remisión se ve en su propia columna y también sirve para buscar.
- **Estado:** **Activas** (borradores y cerradas), **Solo borradores**, **Solo cerradas**, **Anuladas** o **Todas**.
- **Desde / Hasta:** filtra por fechas. **Quitar filtros** vuelve a empezar.
- Toca una fila para abrir el **detalle** completo.
- **Descargar Excel:** baja todas las recepciones con todas sus columnas. La hoja **Consolidado** (la última del libro) trae un resumen corto: recepción, fecha, guía, lote, proveedor, especie, llegó, libras reportadas, libras planta y diferencia (sin las anuladas ni las eliminadas).

---

### 4.1. Ver los reportes

Si tu administrador te dio el permiso, en el **menú** (las tres rayas) aparece **Reportes**. También hay un botón **Reportes** en el listado de recepciones.

- **Filtros:** **Desde** y **Hasta** (al abrir: del día 1 del mes a hoy), **Agrupar por** Día, Semana (empieza el **lunes**) o Mes, y atajos como **Hoy**, **Esta semana**, **Este mes**, **Mes anterior**, **Últimos 30 días** y **Este año**.
- **Cinco pestañas:** **Libras** (libras planta, reportadas y diferencia), **Lotes**, **Proveedores**, **Libras por proveedor** y **Especie por proveedor**.
- **Qué suma:** solo recepciones **cerradas**; las **anuladas, eliminadas y borradores no cuentan** (los borradores solo si marcas **Incluir borradores**). Los reportes usan las **libras de planta**.
- **Lb / Kg:** el interruptor de arriba a la derecha cambia tarjetas, gráfico, tablas y archivos.
- **Descargar:** botones para **CSV, Excel o PDF** del reporte que estás viendo.
- **Necesita señal:** sin conexión verás el último reporte cargado con un aviso; no puedes pedir otro.

---

## 5. Corregir o anular una recepción

{{img:detalle|Detalle de una recepción}}

Dentro del detalle hay botones según tus permisos:

| Botón | Qué hace |
|---|---|
| **Editar** | Abre el formulario con los datos para corregirlos. **Solo puedes editar lo que tú registraste**. Los campos en gris (**fecha de llegada, lote, proveedor y «Realizado por»**) no se pueden modificar: si alguno está mal, anula la recepción y crea una nueva |
| **Anular** | Marca la recepción como **Anulada** (queda guardada, pero no cuenta en los reportes). Pide un **motivo** de 5 a 500 caracteres |
| **PDF** | Descarga la hoja para imprimir (sección 6) |
| **QR** (en cada bin de «Almacenamiento de materia prima») | Genera y descarga una **imagen con el código QR de ese bin** (lote abajo; al escanearlo se ve lote, proveedor, especie y guía; las tildes y la «ñ» salen sin tilde para que lo lea cualquier lector). Solo se genera cuando tocas el botón; también está en el formulario, junto a cada bin |

Cuando el administrador **elimina** una recepción, la aplicación vuelve al listado y ahí ya no aparece.

Una recepción **no se borra**. Si necesitas que **desaparezca del todo de las listas** o recuperar una anulada, **pídeselo al administrador** (él puede **Eliminar** y **Reactivar**).

> **Editar, anular y ver fotos necesitan señal.** Sin señal esos botones aparecen apagados, con una explicación.

---

## 6. Descargar el PDF e imprimir para firmar

1. Abre la recepción y toca **PDF**. Se descarga **un archivo** con el nombre `Recepcion_REC-AAAAMMDD-NNNN_lote-….pdf`. **No necesita señal** (si ya tienes la recepción abierta).
2. El PDF respeta el interruptor **Lb / Kg**: si estaba en **Kg**, todos los pesos salen en kilos y el documento lo indica abajo.
3. Ábrelo desde las descargas de la tablet e imprímelo en **A4 horizontal, tamaño real (100 %)**.
4. Firma a mano: **«REALIZADO POR»** (sobre su línea sale impreso un **QR de firma** con el lote y tu nombre) y **«REVISADO POR»**, con **ID** y **fecha**.

{{img:pdf_muestra|Ejemplo de la hoja en PDF}}

Si la recepción tiene **muchos bines**, el PDF sale en **2 hojas o más**; las **firmas están en la última**. Una recepción anulada lleva la marca **ANULADA**.

---

## 7. Cambiar mi contraseña

Menú **Cambiar mi contraseña** > escribe la **contraseña actual**, la **nueva** y repítela > guarda. Usa por lo menos **10 caracteres** y no la compartas.

---

## 8. Cuando se va la señal

**Puedes seguir registrando recepciones nuevas.** La aplicación lo avisa con **«Sin conexión»** (punto rojo) y una franja amarilla.

1. Llena el formulario como siempre (incluidas las fotos) y toca **Guardar y cerrar** o **Guardar borrador**.
2. Verás **«Guardada en este dispositivo»**. Arriba aparece el chip **«1 pendiente»**.
3. Cuando **vuelve la señal**, la aplicación **las envía sola** (y también cada minuto, o si tocas **Enviar ahora**). Verás el aviso **«Se envió 1 recepción pendiente»**.
4. **Nunca se duplican:** aunque el envío se corte a la mitad, el sistema reconoce que ya la recibió.

**Qué debes cuidar:**

- **No borres los datos del navegador** ni desinstales la aplicación mientras haya pendientes: **se perderían**.
- Para que se envíen, **la aplicación debe estar abierta** y con tu sesión. Si la cierras, se envían la próxima vez que la abras con señal.
- **Cada pendiente es de quien lo creó**: si otra persona usa la misma tablet, no los envía; los envía su dueña cuando inicie sesión.

**Pantalla Pendientes** (toca el chip amarillo): cada recepción muestra su estado:

| Estado | Qué significa | Qué hacer |
|---|---|---|
| **En espera** | Aún no se envía | Nada; se enviará sola. O toca **Enviar ahora** si ya hay señal |
| **Rechazada** | El servidor la rechazó y dice por qué (por ejemplo, **guía repetida** o **lote cerrado**) | Toca **Corregir**, arregla el dato y guarda; o **Descartar** si no hace falta |
| **Faltan fotos** | La recepción llegó pero alguna foto no subió | Toca **Enviar ahora**; si sigue, **Reintentar fotos** |

---

## 9. Problemas frecuentes

| Qué ves | Qué significa | Qué hacer |
|---|---|---|
| **«Correo o contraseña incorrectos»** | Datos mal escritos | Revisa mayúsculas y espacios; si sigue, pide al administrador que te cambie la contraseña |
| **Tu cuenta está desactivada** o **no ves el módulo** | El administrador te quitó el acceso o no te lo ha dado | Avisa al administrador |
| **«Ya existe una recepción con esa guía de remisión»** | La guía ya se registró | Revisa el número; si es un error de la guía anterior, avisa al administrador |
| **«El lote … ya está cerrado»** | Ese lote no admite más camiones | Avisa al administrador para que lo **reabra** |
| **«El formato no es válido»** (lote) | El lote no tiene 3 grupos separados por guion | Escríbelo como `123-456-789` |
| **«Para cerrar indica las libras…»** | Falta un dato obligatorio para cerrar | Llénalo, o usa **Guardar borrador** |
| **El PDF no se descarga** | El navegador bloqueó la descarga, o la recepción no estaba abierta | Revisa las descargas de Chrome; abre la recepción con señal y repite |
| **La pantalla se ve vieja o falta un botón** | La tablet guardó una versión antigua | Cierra la aplicación y ábrela con señal; si sigue, pide a tu administrador «actualizar la aplicación» |
| **El reporte no carga o dice «Sin conexión»** | Los reportes se calculan en el servidor | Espera a tener señal y vuelve a tocar el reporte |
| **Falta una recepción en el reporte** | Estaba anulada, eliminada o en borrador, o está fuera de las fechas | Revisa el estado de la recepción y el rango **Desde / Hasta** |
| **Algo no funciona y no sabes qué** | — | Anota la hora, el número de recepción y **toma una captura** de pantalla; envíala al administrador |

---

## 10. Tarjeta de bolsillo

- **Entrar** con tu correo y contraseña → **Recepción** → **Nueva recepción**.
- **Obligatorio:** fecha, lote, proveedor (si el lote es nuevo), especie, guía de remisión, N.º de gavetas o bines.
- **Para cerrar:** peso reportado y peso planta (las gavetas pesadas son opcionales).
- **Lote abierto** si vienen más camiones; **Cerrar lote** solo en el último.
- **Sin señal:** sigue; queda como **pendiente** y se envía sola. **No borres datos del navegador.**
- **PDF:** botón **PDF** en el detalle → imprimir A4 horizontal → firmar **Realizado por** (sobre su línea va el **QR de firma** con el lote y tu nombre) y **Revisado por**.
- **Equivocaciones:** **Editar** (tuyas) o **Anular**. Para borrar o reactivar, pide al administrador.
- **Reportes:** menú > **Reportes**; solo cuentan las recepciones **cerradas** y se miden en **libras de planta**.
