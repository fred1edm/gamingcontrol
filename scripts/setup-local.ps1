param([string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
function Check-Exit([string]$Step) { if ($LASTEXITCODE -ne 0) { throw "$Step falló (código $LASTEXITCODE)." } }
if (!(Test-Path -LiteralPath (Join-Path $PostgresBin 'initdb.exe'))) { throw 'No se encontró PostgreSQL 18. Usa -PostgresBin con su carpeta bin.' }
if ((& node --version) -notmatch '^v24\.') { throw 'Se requiere Node.js 24 LTS.' }
if ((& (Join-Path $PostgresBin 'postgres.exe') --version) -notmatch '\s18\.') { throw 'Se requiere PostgreSQL 18.' }
New-Item -ItemType Directory -Force .local | Out-Null
& node scripts/bootstrap.mjs
Check-Exit 'Configuración'
$dbPassword = [IO.File]::ReadAllText((Join-Path $projectRoot '.local/db-password')).Trim()
$dataPath = Join-Path $projectRoot '.local/pgdata'
# Only this project's isolated cluster; never alter the pre-existing service.
if (!(Test-Path -LiteralPath (Join-Path $dataPath 'PG_VERSION'))) {
  New-Item -ItemType Directory -Force $dataPath | Out-Null
  & (Join-Path $PostgresBin 'initdb.exe') -D $dataPath -U gaming --pwfile="$projectRoot/.local/db-password" -A scram-sha-256 --encoding=UTF8 --locale=C
  Check-Exit 'Inicialización PostgreSQL'
}
& (Join-Path $PostgresBin 'pg_ctl.exe') -D $dataPath status 2>$null
if ($LASTEXITCODE -ne 0) {
  $pgArgs = '-D "' + $dataPath + '" -l "' + (Join-Path $projectRoot '.local/postgres.log') + '" -o "-h 127.0.0.1 -p 55432" -w start'
  $pgProcess = Start-Process -FilePath (Join-Path $PostgresBin 'pg_ctl.exe') -ArgumentList $pgArgs -WindowStyle Hidden -PassThru
  # Wait only for pg_ctl, not its long-running postgres child.
  $pgProcess.WaitForExit()
  if ($pgProcess.ExitCode -ne 0) { throw 'No se pudo iniciar PostgreSQL aislado. Revisa .local/postgres.log y el puerto 55432.' }
}
$oldPgPassword = $env:PGPASSWORD
$oldDatabaseUrl = $env:DATABASE_URL
$oldTestDatabaseUrl = $env:TEST_DATABASE_URL
try {
  $env:PGPASSWORD = $dbPassword
  foreach ($databaseName in @('gaming_control','gaming_control_test')) {
    $exists = & (Join-Path $PostgresBin 'psql.exe') -h 127.0.0.1 -p 55432 -U gaming -d postgres -w -tAc "SELECT 1 FROM pg_database WHERE datname='$databaseName'"
    Check-Exit 'Conexión PostgreSQL'
    if ($exists -ne '1') {
      & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p 55432 -U gaming -w $databaseName
      Check-Exit "Crear $databaseName"
    }
  }
  # npm ci puede fallar por una desconexión transitoria y dejar node_modules incompleto.
  # Reintentar con la caché local y, si hace falta, reparar con npm install.
  $npmOptions = @('--cache', '.local/npm-cache', '--prefer-offline', '--fetch-retries', '5', '--fetch-retry-factor', '2', '--fetch-retry-mintimeout', '2000', '--fetch-retry-maxtimeout', '120000', '--no-audit', '--no-fund')
  & npm.cmd ci @npmOptions
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'npm ci no completó; reparando dependencias con npm install. Revisa la conexión si vuelve a fallar.'
    & npm.cmd install @npmOptions
  }
  Check-Exit 'Instalación npm'
  & npm.cmd run db:generate
  Check-Exit 'Generar cliente Prisma'
  $env:DATABASE_URL = "postgresql://gaming:$dbPassword@127.0.0.1:55432/gaming_control"
  & npm.cmd run db:migrate
  Check-Exit 'Migración principal'
  & npm.cmd run db:seed
  Check-Exit 'Seed'
  $env:TEST_DATABASE_URL = "postgresql://gaming:$dbPassword@127.0.0.1:55432/gaming_control_test"
  $env:DATABASE_URL = $env:TEST_DATABASE_URL
  & npm.cmd run db:migrate
  Check-Exit 'Migración de pruebas'
  & npm.cmd run test:integration
  Check-Exit 'Pruebas PostgreSQL'
  & npm.cmd test
  Check-Exit 'Pruebas unitarias'
  & npm.cmd run build
  Check-Exit 'Compilación'
  & npm.cmd run lint
  Check-Exit 'ESLint'
  Write-Host 'Instalación y verificaciones terminadas. Ejecuta .\scripts\start-local.ps1'
  Write-Host 'Usuario admin@gaming.local. La contraseña ADMIN_PASSWORD está en .env.'
} finally {
  $env:PGPASSWORD = $oldPgPassword
  $env:DATABASE_URL = $oldDatabaseUrl
  $env:TEST_DATABASE_URL = $oldTestDatabaseUrl
}
