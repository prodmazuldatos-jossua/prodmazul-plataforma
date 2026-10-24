# Prodmazul · Fase 4 · Parte 4 · Prueba de la API como la usará la aplicación (con inicio de sesión real)
# Qué hace: inicia sesión con un usuario OPERATIVO, guarda una recepción de prueba, la reenvía, la consulta, la lista,
# la edita y comprueba que la API rechace lo incorrecto. Te pide los datos al ejecutarla: nada queda escrito en el archivo.
# La recepción de prueba queda guardada: bórrala después con docs\limpiar_recepcion.sql (la guía que usó se muestra al final).
#
# Cómo ejecutarla (PowerShell normal, no como administrador):
#   cd C:\Proyectos\prodmazul-plataforma
#   powershell.exe -ExecutionPolicy Bypass -File .\docs\prueba_api_parte4.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$url    = (Read-Host 'URL del proyecto (por ejemplo https://abcdefgh.supabase.co)').Trim().TrimEnd('/')
$anon   = (Read-Host 'Clave anon (la PÚBLICA, nunca la service_role)').Trim()
$correo = (Read-Host 'Correo del usuario operativo').Trim()
$seg    = Read-Host 'Contraseña (no se muestra)' -AsSecureString
$clave  = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg))

$script:bien = 0
$script:mal  = 0
function Resultado($nombre, $condicion, $detalle = '') {
  if ($condicion) { $script:bien++; Write-Host "  OK     $nombre" -ForegroundColor Green }
  else            { $script:mal++;  Write-Host "  FALLO  $nombre  $detalle" -ForegroundColor Red }
}
function Json($obj) { $b = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 10 -Compress)); return , $b }

# Llama a una función de la API. Devuelve @{ ok = $true; datos = ... } o @{ ok = $false; mensaje = 'E_XXX|texto' }
function Llamar($funcion, $cuerpo, $token) {
  $cab = @{ apikey = $anon; Authorization = "Bearer $token" }
  try {
    $r = Invoke-RestMethod -Method Post -Uri "$url/rest/v1/rpc/$funcion" -Headers $cab -ContentType 'application/json; charset=utf-8' -Body (Json $cuerpo)
    return @{ ok = $true; datos = $r }
  } catch {
    $m = $_.ErrorDetails.Message
    if (-not $m -and $_.Exception.Response) {
      try { $m = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
    }
    try { $m = ($m | ConvertFrom-Json).message } catch {}
    return @{ ok = $false; mensaje = [string]$m }
  }
}
function EsError($r, $codigo) { return (-not $r.ok) -and ($r.mensaje -like "$codigo|*") }

Write-Host "`n1. Inicio de sesión"
try {
  $login = Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" -Headers @{ apikey = $anon } -ContentType 'application/json' -Body (Json @{ email = $correo; password = $clave })
  $token = $login.access_token
} catch {
  $detalle = $_.ErrorDetails.Message
  if (-not $detalle -and $_.Exception.Response) {
    try { $detalle = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
  }
  if (-not $detalle) { $detalle = $_.Exception.Message }
  Write-Host '  No se pudo iniciar sesión. Respuesta del servidor (sin datos secretos):' -ForegroundColor Red
  Write-Host "  $detalle" -ForegroundColor Yellow
  exit 1
}
$clave = $null
Resultado 'el inicio de sesión devuelve un token' ($token.Length -gt 20)

$hoy   = (Get-Date).ToString('yyyy-MM-dd')
$guia  = 'ZZ-API-' + (Get-Random -Minimum 10000 -Maximum 99999)
$uuid  = [guid]::NewGuid().ToString()
$datos = @{
  client_uuid = $uuid; estado = 'cerrado'; fecha_llegada = $hoy; placa_vehiculo = 'ZZP-0001'
  lote_id = '995-995-995'; proveedor = 'ZZ PRUEBA API PROVEEDOR'; especie = 'ZZ PRUEBA API ESPECIE'
  guia_remision = $guia; num_gavetas_bines = 2; libras_reportadas = 500; libras_planta = 495
  hora_inicio_descarga = '08:00'; hora_fin_descarga = '08:45'
  gavetas = @(@{ num_gaveta = 1; peso_lb = 240 }, @{ num_gaveta = 2; peso_lb = 255 })
  temperaturas = @(@{ lectura_id = 1; bines = 'B1'; temperatura_c = 2.5 })
  almacenamiento = @(@{ num_bin = 'B1'; sellos_recepcion = 'S1'; sellos_almacenamiento = 'A1'; temperatura_c = 2.5; libras_aprox = 495 })
}

Write-Host "`n2. Guardar"
$r = Llamar 'api_m01_guardar_recepcion' @{ p = $datos } $token
Resultado 'se guarda la recepción y devuelve su identificador' ($r.ok -and $r.datos.recepcion_id -match '^REC-\d{8}-\d{4}$' -and $r.datos.version -eq 1) ($r.mensaje)
$id = $r.datos.recepcion_id
Write-Host "     Identificador: $id   Guía: $guia"

$r2 = Llamar 'api_m01_guardar_recepcion' @{ p = $datos } $token
Resultado 'reenviar el mismo envío NO duplica (duplicado = true, mismo identificador)' ($r2.ok -and $r2.datos.duplicado -eq $true -and $r2.datos.recepcion_id -eq $id) ($r2.mensaje)

$otra = $datos.Clone(); $otra.client_uuid = [guid]::NewGuid().ToString()
Resultado 'la misma guía con otro envío se rechaza (E_DUPLICADO)' (EsError (Llamar 'api_m01_guardar_recepcion' @{ p = $otra } $token) 'E_DUPLICADO')

$mala = $datos.Clone(); $mala.client_uuid = [guid]::NewGuid().ToString(); $mala.guia_remision = $guia + '-B'; $mala.fecha_llegada = (Get-Date).AddDays(2).ToString('yyyy-MM-dd')
Resultado 'una fecha futura se rechaza (E_VALIDACION)' (EsError (Llamar 'api_m01_guardar_recepcion' @{ p = $mala } $token) 'E_VALIDACION')

Write-Host "`n3. Consultar"
$o = Llamar 'api_m01_obtener_recepcion' @{ p_id = $id } $token
Resultado 'obtener devuelve la recepción con sus gavetas' ($o.ok -and $o.datos.gavetas.Count -eq 2 -and [double]$o.datos.peso_promedio_lb -eq 247.5) ($o.mensaje)
Resultado 'la diferencia calculada es -5 lb' ($o.ok -and [double]$o.datos.diferencia_lb -eq -5)
$l = Llamar 'api_m01_listar_recepciones' @{ p = @{ busqueda = $guia } } $token
Resultado 'el listado encuentra la recepción por su guía' ($l.ok -and $l.datos.total -eq 1 -and $l.datos.items[0].recepcion_id -eq $id) ($l.mensaje)
$lo = Llamar 'api_obtener_lote' @{ p_lote = '995-995-995' } $token
Resultado 'api_obtener_lote reconoce el lote ya creado' ($lo.ok -and $lo.datos.existe -eq $true) ($lo.mensaje)
$c = Llamar 'api_listar_catalogo' @{ p_tipo = 'proveedores'; p_busqueda = 'prueba api' } $token
Resultado 'el catálogo de proveedores lo encuentra sin importar mayúsculas' ($c.ok -and $c.datos.Count -ge 1) ($c.mensaje)

Write-Host "`n4. Editar"
$ed = $datos.Clone(); $ed.recepcion_id = $id; $ed.version = 1; $ed.client_uuid = [guid]::NewGuid().ToString(); $ed.libras_planta = 505
$e1 = Llamar 'api_m01_guardar_recepcion' @{ p = $ed } $token
Resultado 'editar con la versión correcta sube la versión a 2' ($e1.ok -and $e1.datos.version -eq 2) ($e1.mensaje)
$e2 = Llamar 'api_m01_guardar_recepcion' @{ p = $ed } $token
Resultado 'editar con una versión vieja se rechaza (E_VERSION)' (EsError $e2 'E_VERSION')

Write-Host "`n5. Seguridad"
$sin = Llamar 'api_m01_listar_recepciones' @{ p = @{} } $anon
Resultado 'sin iniciar sesión la API no responde datos' (-not $sin.ok)
try {
  Invoke-RestMethod -Method Get -Uri "$url/rest/v1/recepciones?select=*" -Headers @{ apikey = $anon; Authorization = "Bearer $token" } | Out-Null
  Resultado 'las tablas no se pueden leer directamente' $false
} catch { Resultado 'las tablas no se pueden leer directamente' $true }

Write-Host ("`nRESULTADO: {0} correctas, {1} con fallo." -f $script:bien, $script:mal)
Write-Host "Para borrar esta recepción de prueba usa docs\limpiar_recepcion.sql con la guía: $guia"
