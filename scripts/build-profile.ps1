$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'profile-src\B70D27A4-6A71-4C7A-942D-2A90FA660C2A.sdProfile'
$destination = Join-Path $root 'com.driveline.codex-command-center.sdPlugin\profiles\Codex Command Center.streamDeckProfile'
$tempZip = Join-Path $env:TEMP ('codex-command-center-' + [guid]::NewGuid().ToString('N') + '.zip')

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
Compress-Archive -LiteralPath $source -DestinationPath $tempZip -CompressionLevel Optimal
Copy-Item -LiteralPath $tempZip -Destination $destination -Force
