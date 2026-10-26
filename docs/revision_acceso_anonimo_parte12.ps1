# Prodmazul · Fase 4 · Parte 12 · Revisión de seguridad desde fuera (como lo vería un desconocido)
# Qué hace: (1) intenta usar la API SIN iniciar sesión y comprueba que todo sea rechazado, (2) revisa las cabeceras de
# seguridad del sitio publicado, (3) revisa que no haya secretos en Git, (4) revisa vulnerabilidades conocidas de las librerías.
# NO guarda ni modifica datos. Te pide la URL y la clave PÚBLICA al ejecutarla: nada queda escrito en el archivo.
#
# Cómo ejecutarla (PowerShell normal, no como administrador):
#   cd C:\Proyectos\prodmazul-plataforma
#   powershell.exe -ExecutionPolicy Bypass -File .\docs\revision_acceso_anonimo_parte12.ps1

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$url   = (Read-Host 'URL del proyecto Supabase (por ejemplo https://abcdefgh.supabase.co)').Trim().TrimEnd('/')
$anon  = (Read-Host 'Clave anon (la PÚBLICA, nunca la service_role)').Trim()
$sitio = (Read-Host 'Dirección de tu sitio publicado (por ejemplo https://prodmazul.pages.dev)').Trim().TrimEnd('/')

$script:bien = 0
$script:mal  = 0
function Resultado($nombre, $condicion, $detalle = '') {
  if ($condicion) { $script:bien++; Write-Host "  OK     $nombre" -ForegroundColor Green }
  else            { $script:mal++;  Write-Host "  FALLO  $nombre  $detalle" -ForegroundColor Red }
}

# Devuelve el código HTTP y el cuerpo, sin lanzar excepción.
function Pedir($metodo, $ruta, $cuerpo = $null, $extra = @{}) {
  $cab = @{ apikey = $anon; Authorization = "Bearer $anon" }
  foreach ($k in $extra.Keys) { $cab[$k] = $extra[$k] }
  try {
    $p = @{ Method = $metodo; Uri = "$url$ruta"; Headers = $cab; UseBasicParsing = $true }
    if ($null -ne $cuerpo) { $p.ContentType = 'application/json'; $p.Body = $cuerpo }
    $r = Invoke-WebRequest @p
    return @{ codigo = [int]$r.StatusCode; texto = [string]$r.Content }
  } catch {
    $c = 0
    if ($_.Exception.Response) { $c = [int]$_.Exception.Response.StatusCode }
    $t = ''
    if ($_.ErrorDetails) { $t = [string]$_.ErrorDetails.Message }
    return @{ codigo = $c; texto = $t }
  }
}

Write-Host "`n1. Acceso anónimo a la API (todo debe ser rechazado)" -ForegroundColor Cyan
$r = Pedir 'POST' '/rest/v1/rpc/api_mi_perfil' '{}'
Resultado 'api_mi_perfil sin iniciar sesión es rechazada' ($r.codigo -ge 400) "(código $($r.codigo))"
$r = Pedir 'POST' '/rest/v1/rpc/api_m01_listar_recepciones' '{"p":{"limite":5}}'
Resultado 'api_m01_listar_recepciones sin iniciar sesión es rechazada' ($r.codigo -ge 400) "(código $($r.codigo))"
$r = Pedir 'POST' '/rest/v1/rpc/api_m01_obtener_recepcion' '{"p_id":"REC-20260101-0001"}'
Resultado 'api_m01_obtener_recepcion sin iniciar sesión es rechazada' ($r.codigo -ge 400) "(código $($r.codigo))"
$r = Pedir 'POST' '/rest/v1/rpc/api_m01_guardar_recepcion' '{"p":{}}'
Resultado 'api_m01_guardar_recepcion sin iniciar sesión es rechazada' ($r.codigo -ge 400) "(código $($r.codigo))"
$r = Pedir 'GET' '/rest/v1/perfiles?select=*' $null @{ 'Accept-Profile' = 'core' }
Resultado 'La tabla core.perfiles no se puede leer' ($r.codigo -ge 400 -or $r.texto.Trim() -eq '[]') "(código $($r.codigo))"
$r = Pedir 'GET' '/rest/v1/recepciones?select=*' $null @{ 'Accept-Profile' = 'm01_recepcion' }
Resultado 'La tabla m01_recepcion.recepciones no se puede leer' ($r.codigo -ge 400 -or $r.texto.Trim() -eq '[]') "(código $($r.codigo))"
$r = Pedir 'GET' '/rest/v1/' $null
Resultado 'No se publica la lista de tablas de la API' ($r.codigo -ge 400 -or ($r.texto -notmatch '"/perfiles"|"/recepciones"|"/auditoria"')) "(código $($r.codigo))"

Write-Host "`n2. Fotos (bucket privado)" -ForegroundColor Cyan
$r = Pedir 'GET' '/storage/v1/object/public/m01-recepcion-fotos/prueba.jpg'
Resultado 'No existe dirección pública para las fotos' ($r.codigo -ge 400) "(código $($r.codigo))"
$r = Pedir 'GET' '/storage/v1/bucket/m01-recepcion-fotos'
Resultado 'El bucket de fotos no se ve sin sesión' ($r.codigo -ge 400 -or $r.texto -notmatch '"public":\s*true') "(código $($r.codigo))"
$r = Pedir 'POST' '/storage/v1/object/list/m01-recepcion-fotos' '{"prefix":"","limit":5}'
Resultado 'No se puede listar el contenido del bucket sin sesión' ($r.codigo -ge 400 -or $r.texto.Trim() -eq '[]') "(código $($r.codigo))"

Write-Host "`n3. Cabeceras de seguridad del sitio publicado" -ForegroundColor Cyan
try {
  $h = (Invoke-WebRequest -Uri "$sitio/" -UseBasicParsing).Headers
  foreach ($n in 'Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Strict-Transport-Security', 'Permissions-Policy') {
    Resultado "Cabecera $n presente" ($null -ne $h[$n] -and "$($h[$n])".Length -gt 0)
  }
  Resultado 'X-Frame-Options es DENY' ("$($h['X-Frame-Options'])" -eq 'DENY')
  Resultado 'La política de contenido no permite scripts de otros sitios' ("$($h['Content-Security-Policy'])" -match "script-src 'self'" -and "$($h['Content-Security-Policy'])" -notmatch "unsafe-eval")
} catch {
  Resultado 'Se pudo abrir el sitio publicado' $false $_.Exception.Message
}

Write-Host "`n4. Secretos fuera del código y de Git" -ForegroundColor Cyan
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
  $ign = git check-ignore apps/web/.env.local 2>$null
  Resultado '.env.local está ignorado por Git' ([bool]$ign)
  $sub = git ls-files | Select-String -Pattern '(^|/)\.env(\.local)?$|^backups/|\.pem$|\.key$'
  Resultado 'Git no guarda .env.local, copias de seguridad ni llaves' (-not $sub) ($sub -join ', ')
  $sec = git grep -nIE "sb_secret_[A-Za-z0-9_-]{20,}|service_role[^a-z_]*[:=]\s*['""]?eyJ|SUPABASE_DB_PASSWORD\s*=\s*\S+" -- . 2>$null
  Resultado 'No hay claves secretas en los archivos de Git' (-not $sec) ($sec -join ' | ')
} else {
  Write-Host '  (Git no está instalado en esta ventana: omitido)' -ForegroundColor Yellow
}

Write-Host "`n5. Librerías con vulnerabilidades conocidas (solo las que viajan a la aplicación)" -ForegroundColor Cyan
Push-Location 'apps\web'
$aud = npm audit --omit=dev 2>&1 | Out-String
Pop-Location
Resultado 'npm audit (producción) no reporta vulnerabilidades' ($aud -match 'found 0 vulnerabilities') ($aud.Trim().Split("`n")[-1])

Write-Host "`nRESULTADO: $($script:bien) correctas, $($script:mal) con fallo." -ForegroundColor $(if ($script:mal -eq 0) { 'Green' } else { 'Red' })
