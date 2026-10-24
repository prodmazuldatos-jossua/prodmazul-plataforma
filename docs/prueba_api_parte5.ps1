# Prodmazul · Fase 4 · Parte 5 · Prueba de anular, eliminar y reactivar por la API (con inicio de sesión real)
# Qué hace: inicia sesión con un usuario OPERATIVO, crea una recepción de prueba, la anula y comprueba que la API
# rechace lo incorrecto (motivo corto, versión vieja, editar una anulada) y que un operativo NO pueda eliminar ni reactivar.
# Te pide los datos al ejecutarla: nada queda escrito en el archivo.
# Las recepciones de prueba quedan guardadas: se borran después con el bloque del paso 7 de la guía (lote 994-994-994).
#
# Cómo ejecutarla (PowerShell normal, no como administrador):
#   cd C:\Proyectos\prodmazul-plataforma
#   powershell.exe -ExecutionPolicy Bypass -File .\docs\prueba_api_parte5.ps1

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
$guia  = 'ZZ-API5-' + (Get-Random -Minimum 10000 -Maximum 99999)
$datos = @{
  client_uuid = [guid]::NewGuid().ToString(); estado = 'cerrado'; fecha_llegada = $hoy
  lote_id = '994-994-994'; proveedor = 'ZZ PRUEBA API5 PROVEEDOR'; especie = 'ZZ PRUEBA API5 ESPECIE'
  guia_remision = $guia; num_gavetas_bines = 1; libras_reportadas = 200; libras_planta = 198
  gavetas = @(@{ num_gaveta = 1; peso_lb = 198 })
}

Write-Host "`n2. Crear la recepción de prueba"
$c = Llamar 'api_m01_guardar_recepcion' @{ p = $datos } $token
Resultado 'se crea la recepción' ($c.ok -and $c.datos.version -eq 1) ($c.mensaje)
$id = $c.datos.recepcion_id
Write-Host "     Identificador: $id   Guía: $guia"

Write-Host "`n3. Anular"
Resultado 'anular sin motivo se rechaza (E_VALIDACION)' (EsError (Llamar 'api_m01_anular' @{ p_id = $id; p_motivo = ''; p_version = 1 } $token) 'E_VALIDACION')
Resultado 'un motivo de 3 letras se rechaza (E_VALIDACION)' (EsError (Llamar 'api_m01_anular' @{ p_id = $id; p_motivo = 'abc'; p_version = 1 } $token) 'E_VALIDACION')
Resultado 'una versión vieja se rechaza (E_VERSION)' (EsError (Llamar 'api_m01_anular' @{ p_id = $id; p_motivo = 'Guía mal digitada'; p_version = 9 } $token) 'E_VERSION')
$a = Llamar 'api_m01_anular' @{ p_id = $id; p_motivo = 'Guía mal digitada'; p_version = 1 } $token
Resultado 'anular con motivo y versión correctos: estado anulado y versión 2' ($a.ok -and $a.datos.estado -eq 'anulado' -and $a.datos.version -eq 2) ($a.mensaje)

Write-Host "`n4. Consultar una anulada"
$l1 = Llamar 'api_m01_listar_recepciones' @{ p = @{ busqueda = $guia } } $token
Resultado 'el listado normal ya no la muestra' ($l1.ok -and $l1.datos.total -eq 0) ($l1.mensaje)
$l2 = Llamar 'api_m01_listar_recepciones' @{ p = @{ busqueda = $guia; estado = 'anulado' } } $token
Resultado 'el filtro «anulado» sí la muestra' ($l2.ok -and $l2.datos.total -eq 1) ($l2.mensaje)
$o = Llamar 'api_m01_obtener_recepcion' @{ p_id = $id } $token
Resultado 'al abrirla se ve el motivo de la anulación' ($o.ok -and $o.datos.motivo_anulacion -eq 'Guía mal digitada' -and $o.datos.estado -eq 'anulado') ($o.mensaje)

Write-Host "`n5. Lo que NO debe poder hacer un operativo"
$ed = $datos.Clone(); $ed.recepcion_id = $id; $ed.version = 2; $ed.client_uuid = [guid]::NewGuid().ToString()
Resultado 'editar una anulada se rechaza (E_ESTADO)' (EsError (Llamar 'api_m01_guardar_recepcion' @{ p = $ed } $token) 'E_ESTADO')
Resultado 'eliminar se rechaza (E_PERMISO)' (EsError (Llamar 'api_m01_eliminar' @{ p_id = $id; p_motivo = 'Intento de eliminar'; p_version = 2 } $token) 'E_PERMISO')
Resultado 'reactivar se rechaza (E_PERMISO)' (EsError (Llamar 'api_m01_reactivar' @{ p_id = $id; p_version = 2 } $token) 'E_PERMISO')
Resultado 'anular dos veces se rechaza (E_ESTADO)' (EsError (Llamar 'api_m01_anular' @{ p_id = $id; p_motivo = 'Otra vez aquí'; p_version = 2 } $token) 'E_ESTADO')
$sin = Llamar 'api_m01_anular' @{ p_id = $id; p_motivo = 'Sin sesión'; p_version = 2 } $anon
Resultado 'sin iniciar sesión la API no responde' (-not $sin.ok)

Write-Host ("`nRESULTADO: {0} correctas, {1} con fallo." -f $script:bien, $script:mal)
Write-Host "Para borrar esta recepción de prueba usa el bloque del paso 7 de la guía (lote 994-994-994). Guía usada: $guia"
