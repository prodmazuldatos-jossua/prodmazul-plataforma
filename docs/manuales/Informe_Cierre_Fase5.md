# Prodmazul · Informe de cierre de la Fase 5

**Resumen en una frase:** el **Módulo 1 · Recepción** ahora tiene **respaldo automático en Google** (Sheets y Drive), **retención de fotos a 60 días con copia confirmada**, **panel de reportes** y **pantallas de administración**, con **restauración probada en simulación**; queda pendiente tu aprobación tras la matriz de aceptación en la tablet y las acciones de la sección 6.

---

## 1. Qué se entregó

| Partes | Qué se construyó |
|---|---|
| 1–3 | Cuentas y estructura en Google (cuenta DATOS), libro de Sheets por año, receptor de Apps Script |
| 4–5 | Envío por lotes cada 2 horas de Supabase a Sheets (espejo de solo lectura), con reintentos y sin duplicados |
| 6 | Estado y alerta de sincronización (más de 6 horas sin enviar) |
| 7 | Copia de fotos a Drive y **purga a los 60 días solo con copia confirmada** |
| 8 | **Panel de reportes**: libras planta, lotes, proveedores, libras por proveedor y especie por proveedor; descarga CSV, Excel y PDF |
| 9 | Administración de **usuarios** desde la aplicación (crear, rol, desactivar, contraseña) |
| 10 | **Configuración** (8 parámetros con límites), **auditoría** consultable, **lotes** (reabrir) y **catálogo** (unir repetidos) |
| 11 | Aceptación, **restauración desde Sheets, Drive y copia local**, revisión de seguridad ampliada, guía del plan Pro y manuales actualizados |

## 2. Cómo se probó

| Qué | Resultado |
|---|---|
| Pruebas de base de datos (partes 4 a 10, PostgreSQL 16 y PGlite) | **364** comprobaciones, 0 fallos |
| Exportador de Sheets | **184** comprobaciones, 0 fallos |
| Receptor de Apps Script (simulado) | **111** comprobaciones, 0 fallos |
| Usuarios (Edge Function) | **68** comprobaciones, 0 fallos |
| Seguridad de la base | **23** comprobaciones + la revisión ampliada de la Parte 11 (13 filas, todas OK en el entorno de prueba) |
| Pruebas de la aplicación | **226** pruebas, 0 fallos |
| Recorridos de pantalla simulados | Reportes, respaldo, administración y ajustes: 0 fallos |
| **Restauración desde Sheets** | Base vacía reconstruida desde CSV: **las 11 tablas quedan idénticas**, repetirla no duplica y la numeración continúa (**26 comprobaciones** + **28** de la herramienta) |
| **En la tablet real y en tu Supabase real** | **Lo haces tú** con la matriz de la guía de la Parte 11 y las pruebas `docs\prueba_parteN_f5.sql` |

## 3. Reglas que se cumplieron

- **Supabase es el sistema principal**; Sheets es solo un espejo de lectura y se edita nunca.
- **Un libro por año**; fotos respaldadas en Drive.
- Reportes con **libras planta**, semana desde el **lunes**, sin anuladas ni eliminadas, cálculos en la base de datos.
- **Sin correos** y sin recuperación de contraseña por correo.
- **Ningún secreto** en el código ni en Git; la revisión de seguridad solo muestra nombres.

## 4. Límites conocidos (honestos)

| Tema | Detalle |
|---|---|
| **Todo lo probado es simulado** | PostgreSQL, PGlite y navegadores simulados. **No** se probó contra tu Supabase, tu Drive ni Cloudflare reales: por eso existe la matriz en la tablet |
| **Receptor** | En la última verificación tu `ping` respondía **2.1** en vez de **2.2**. **No enciendas la purga** hasta que responda 2.2 |
| **PowerShell** | Los scripts `.ps1` se ejecutan por primera vez en tu PC |
| **Fotos al restaurar** | Es un paso **manual**: descargar la carpeta de Drive y ejecutar `restaurar-fotos.mjs` |
| **Usuarios al restaurar** | Las cuentas de acceso se restauran antes desde `cuentas-FECHA.sql`; sin cuenta no se crea el perfil |
| **Restauración** | Dispara un nuevo envío a Sheets. Un texto que parezca número puede volver como número; un texto vacío opcional vuelve como vacío (NULL) |
| **Contador de numeración** | No está en Sheets; se reconstruye a partir de las recepciones |
| **Unir catálogo** | No se deshace desde la pantalla |
| **Datos de prueba** | Quedan nombres «ZZ Prueba P10» y lotes 991–993 en el catálogo; límpialos cuando quieras |
| **Sin conexión** | Igual que en la Fase 4: solo registrar recepciones nuevas |
| **Power BI** | Es otro proyecto; el espejo de Sheets es su fuente |

## 5. Qué sigue

| Tarea | Nota |
|---|---|
| Plan **Pro** de Supabase | Decides tú la fecha (sección 6) |
| Pago de la cuenta **DATOS** (Google One o Workspace) | Decides tú la fecha |
| Proyecto de **Power BI** | Aparte |
| Siguientes módulos | Mismo patrón que Recepción |

## 6. Tus acciones pendientes

- [ ] Completar la **matriz de aceptación en la tablet** (guía de la Parte 11).
- [ ] Probar una **restauración en tu PC** (Docker local) y anotar el resultado.
- [ ] Ejecutar `docs\revision_seguridad_f5.sql` y revisar el Security Advisor.
- [ ] Confirmar que el receptor responde **2.2** y solo entonces encender la purga.
- [ ] Decidir la **fecha del paso a Pro** y la **fecha del pago de DATOS**.
- [ ] Entregar los **manuales actualizados** al operador y al administrador.
- [ ] Responder **«Fase 5 aprobada»**.
