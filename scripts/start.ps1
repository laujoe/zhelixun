$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'launcher.mjs') 'start'
exit $LASTEXITCODE
