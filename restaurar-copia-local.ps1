# Prodmazul · Fase 4 · Parte 12 · Prueba de RESTAURACIÓN de una copia en tu base de datos LOCAL
# Qué hace: toma los archivos backups\datos-FECHA.sql y backups\cuentas-FECHA.sql y los carga en la base LOCAL de pruebas
# (la que levanta «npx supabase start»), después muestra cuántos datos quedaron y las recepciones más recientes.
# NUNCA toca tu proyecto real de Supabase en internet: solo habla con el contenedor de Docker de tu PC.
#
# Antes: Docker Desktop abierto y, en la carpeta del repositorio:   npx supabase start
# Cómo ejecutarla:
#   cd C:\Proyectos\prodmazul-plataforma
#   powershell.exe -ExecutionPolicy Bypass -File .\restaurar-copia-local.ps1 -Fecha 2026-10-26

param([Parameter(Mandatory = $true)][string]$Fecha)
$ErrorActionPreference = 'Stop'
Set-Location 'C:\Proyectos\prodmazul-plataforma'

$datos   = "backups\datos-$Fecha.sql"
$cuentas = "backups\cuentas-$Fecha.sql"
foreach ($f in $datos, $cuentas, 'docs\restaurar_preparar_local.sql', 'docs\restaurar_verificar.sql') {
  if (-not (Test-Path $f)) { throw "No encuentro el archivo $f" }
}
if (-not (Select-String -Path $datos -Pattern 'm01_recepcion' -Quiet)) {
  throw "El archivo $datos no contiene las recepciones (esquema m01_recepcion). Esa copia es anterior a la Parte 12: haz una copia nueva con el respaldo-diario.ps1 actual."
}

$db = (docker ps --format '{{.Names}}' | Where-Object { $_ -like 'supabase_db_*' } | Select-Object -First 1)
if (-not $db) { throw 'No encuentro la base local. Ejecuta primero:  npx supabase start   (con Docker Desktop abierto).' }
Write-Host "Base local encontrada: $db" -ForegroundColor Cyan

function Cargar($archivo, $nombre, [bool]$obligatorio) {
  docker cp $archivo "${db}:/tmp/$nombre" | Out-Null
  # Lo obligatorio se detiene al primer error. Las cuentas (auth) siguen aunque alguna fila repetida de la base local falle.
  $paro = if ($obligatorio) { 1 } else { 0 }
  docker exec $db psql -U postgres -d postgres -v ON_ERROR_STOP=$paro -q -f "/tmp/$nombre"
  if ($LASTEXITCODE -ne 0) {
    if ($obligatorio) { throw "Falló la carga de $archivo" }
    Write-Host "AVISO: $archivo tuvo avisos (suele ser una fila repetida de la tabla auth de la base local). Se continúa." -ForegroundColor Yellow
  }
}

Write-Host '1/4 Vaciando los datos de la base LOCAL...'
Cargar 'docs\restaurar_preparar_local.sql' 'preparar.sql' $true
Write-Host '2/4 Restaurando las cuentas de acceso...'
Cargar $cuentas 'cuentas.sql' $false
Write-Host '3/4 Restaurando los datos (núcleo y recepciones)...'
Cargar $datos 'datos.sql' $true
Write-Host '4/4 Comprobando lo restaurado...'
docker cp 'docs\restaurar_verificar.sql' "${db}:/tmp/verificar.sql" | Out-Null
docker exec $db psql -U postgres -d postgres -P pager=off -f /tmp/verificar.sql
Write-Host "`nListo. Compara estas cantidades con lo que tenías en Supabase el día $Fecha." -ForegroundColor Green
