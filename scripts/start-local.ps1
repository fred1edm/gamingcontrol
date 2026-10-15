param([string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$dataPath = Join-Path $projectRoot '.local/pgdata'
if (!(Test-Path -LiteralPath (Join-Path $dataPath 'PG_VERSION'))) { throw 'Ejecuta primero .\scripts\setup-local.ps1' }
& (Join-Path $PostgresBin 'pg_ctl.exe') -D $dataPath status 2>$null
if ($LASTEXITCODE -ne 0) {
  $pgArgs = '-D "' + $dataPath + '" -l "' + (Join-Path $projectRoot '.local/postgres.log') + '" -o "-h 127.0.0.1 -p 55432" -w start'
  $pgProcess = Start-Process -FilePath (Join-Path $PostgresBin 'pg_ctl.exe') -ArgumentList $pgArgs -WindowStyle Hidden -PassThru
  # Wait only for pg_ctl, not its long-running postgres child.
  $pgProcess.WaitForExit()
  if ($pgProcess.ExitCode -ne 0) { throw 'PostgreSQL no pudo iniciar. Revisa .local/postgres.log.' }
}
Write-Host 'Abre http://localhost:5173. Ctrl+C detiene API y panel; PostgreSQL permanece activo.'
& npm.cmd run serve
