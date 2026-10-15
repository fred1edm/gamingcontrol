param([string]$OutputPath = '.production')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stage = [IO.Path]::GetFullPath((Join-Path $projectRoot $OutputPath))
Set-Location -LiteralPath $projectRoot

& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "La compilación falló (código $LASTEXITCODE)." }

if (Test-Path -LiteralPath $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path `
  (Join-Path $stage 'app'), `
  (Join-Path $stage 'config'), `
  (Join-Path $stage 'data'), `
  (Join-Path $stage 'backups'), `
  (Join-Path $stage 'logs') | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot 'apps/admin/dist') -Destination (Join-Path $stage 'app/admin') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'apps/api/dist') -Destination (Join-Path $stage 'app/api') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'prisma/migrations') -Destination (Join-Path $stage 'app/prisma/migrations') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'prisma/schema.prisma') -Destination (Join-Path $stage 'app/prisma/schema.prisma')
Copy-Item -LiteralPath (Join-Path $projectRoot 'prisma.config.ts') -Destination (Join-Path $stage 'app/prisma.config.ts')
Copy-Item -LiteralPath (Join-Path $projectRoot '.env.example') -Destination (Join-Path $stage 'config/.env.example')

@'
Gaming Control — staging de producción

Este directorio contiene el resultado compilado y carpetas de operación.
No contiene .env, contraseñas ni datos de desarrollo.

app      Código compilado, panel y migraciones
config   Plantilla de configuración; crear aquí el .env de la instalación
data     Datos persistentes de PostgreSQL o del servicio configurado
backups  Copias de seguridad
logs     Registros de API y servicios
'@ | Set-Content -LiteralPath (Join-Path $stage 'README.txt') -Encoding UTF8

Write-Host "Staging de producción creado en $stage"
