# Prodmazul · copia de seguridad diaria (Parte 12: esquema + datos del núcleo y de Recepción + cuentas)
# Requiere Docker Desktop abierto. La contraseña de la base de datos se toma de la variable SUPABASE_DB_PASSWORD.
# Novedad de la Parte 12: el archivo datos-FECHA.sql ahora incluye también las RECEPCIONES (esquema m01_recepcion).
# Las fotos NO van en esta copia (viven en el almacenamiento de Supabase; en la Fase 5 se respaldan en Drive).
$ErrorActionPreference = 'Continue'
Set-Location 'C:\Proyectos\prodmazul-plataforma'
$fecha = Get-Date -Format 'yyyy-MM-dd'
New-Item -ItemType Directory -Force -Path 'backups' | Out-Null

npx supabase db dump --linked --password $env:SUPABASE_DB_PASSWORD -f "backups\esquema-$fecha.sql"
npx supabase db dump --linked --password $env:SUPABASE_DB_PASSWORD --data-only -s core,m01_recepcion -f "backups\datos-$fecha.sql"
npx supabase db dump --linked --password $env:SUPABASE_DB_PASSWORD --data-only -s auth -f "backups\cuentas-$fecha.sql"

Write-Output "Copias terminadas: $fecha"
Get-ChildItem backups | Where-Object { $_.Name -like "*$fecha*" } | Select-Object Name, Length

# Aviso si el archivo de datos quedó sin recepciones (por ejemplo, si se usó la versión anterior de este script).
$datos = "backups\datos-$fecha.sql"
if (Test-Path $datos) {
  if (-not (Select-String -Path $datos -Pattern 'm01_recepcion' -Quiet)) {
    Write-Host "ATENCION: datos-$fecha.sql no contiene el esquema m01_recepcion. Revisa que estés usando el respaldo-diario.ps1 de la Parte 12." -ForegroundColor Red
  } else {
    Write-Host 'Comprobado: la copia incluye las recepciones (m01_recepcion).' -ForegroundColor Green
  }
}
