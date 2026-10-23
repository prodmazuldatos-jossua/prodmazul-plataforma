# Prodmazul · copia de seguridad diaria (Parte 1: esquema, datos del núcleo y cuentas)
# Requiere Docker Desktop abierto. La contraseña de la base de datos se toma de la variable SUPABASE_DB_PASSWORD.
$ErrorActionPreference = 'Continue'
Set-Location 'C:\Proyectos\prodmazul-plataforma'
$fecha = Get-Date -Format 'yyyy-MM-dd'
New-Item -ItemType Directory -Force -Path 'backups' | Out-Null

npx supabase db dump --linked --password $env:SUPABASE_DB_PASSWORD -f "backups\esquema-$fecha.sql"
npx supabase db dump --linked --password $env:SUPABASE_DB_PASSWORD --data-only -s core -f "backups\datos-$fecha.sql"
npx supabase db dump --linked --password $env:SUPABASE_DB_PASSWORD --data-only -s auth -f "backups\cuentas-$fecha.sql"

Write-Output "Copias terminadas: $fecha"
Get-ChildItem backups | Where-Object { $_.Name -like "*$fecha*" } | Select-Object Name, Length
