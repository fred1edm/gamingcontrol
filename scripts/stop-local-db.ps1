param([string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin')
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dataPath = Join-Path $projectRoot '.local/pgdata'
& (Join-Path $PostgresBin 'pg_ctl.exe') -D $dataPath -m fast -w stop
if ($LASTEXITCODE -ne 0) { throw 'No se pudo detener la instancia local. No se modificó el servicio existente.' }
