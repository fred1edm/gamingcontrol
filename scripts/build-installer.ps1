#Requires -Version 5.1
param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'Node.js/npm no está instalado o no está en PATH.'
}
if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) {
  throw 'Rust/Cargo no está instalado. Instala Rust y vuelve a ejecutar este script.'
}

if (-not $SkipBuild) {
  & npm.cmd run desktop:build
  if ($LASTEXITCODE -ne 0) { throw "La compilación del instalador falló (código $LASTEXITCODE)." }
}

$bundle = Join-Path $projectRoot 'apps/admin/src-tauri/target/release/bundle'
if (-not (Test-Path -LiteralPath $bundle)) { throw "No se encontró el bundle: $bundle" }
Write-Host "Instaladores disponibles en: $bundle"
Get-ChildItem -LiteralPath $bundle -Recurse -File |
  Where-Object { $_.Extension -in '.msi', '.exe' } |
  Select-Object -ExpandProperty FullName
