param([Parameter(Mandatory=$true)][string]$OutputFolder,[switch]$Apply)
$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path $OutputFolder).Path
$project = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location (Join-Path $project 'server')
try {
  if ($Apply) {
    # Custom-format pg_dump stays binary: never pipe its bytes through PowerShell.
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $dumpName = "hisaflow-before-legacy-repair-$stamp.dump"
    & docker compose exec -T postgres pg_dump -U hisaflow -d hisaflow -Fc -f "/tmp/$dumpName"
    if ($LASTEXITCODE -ne 0) { throw 'Database backup failed; repair not applied.' }
    $container = (& docker compose ps -q postgres).Trim()
    if (!$container) { throw 'Postgres container not found.' }
    & docker cp "${container}:/tmp/$dumpName" (Join-Path $resolved $dumpName)
    if ($LASTEXITCODE -ne 0) { throw 'Backup copy failed; repair not applied.' }
    if ((Get-Item (Join-Path $resolved $dumpName)).Length -eq 0) { throw 'Empty database backup.' }
    & docker compose exec -T postgres pg_restore --list "/tmp/$dumpName" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Backup archive validation failed.' }
    $sqlPath = Join-Path $resolved 'apply.sql'
  } else { $sqlPath = Join-Path $resolved 'preview.sql' }
  Get-Content -Raw $sqlPath | & docker compose exec -T postgres psql -U hisaflow -d hisaflow -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'SQL step failed. Read the error; do not reset any data.' }
} finally { Pop-Location }
