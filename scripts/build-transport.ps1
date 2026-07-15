$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $env:LOCALAPPDATA 'CodexDeck\build'
$output = Join-Path $build 'codex-deck-transport.exe'
$blob = Join-Path $root 'build\transport-prep.blob'
$node = (Get-Command node -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $build | Out-Null

if (-not $env:CODEX_DECK_REAL_CLI) {
    $codexPackage = Get-AppxPackage OpenAI.Codex |
        Sort-Object Version -Descending |
        Select-Object -First 1
    if (-not $codexPackage) { throw 'The Codex Windows app is not installed.' }
    $packagedCli = Join-Path $codexPackage.InstallLocation 'app\resources\codex.exe'
    $localCli = Join-Path $build 'codex-real-build.exe'
    Copy-Item -LiteralPath $packagedCli -Destination $localCli -Force
    $env:CODEX_DECK_REAL_CLI = $localCli
}

if (-not (Test-Path -LiteralPath $env:CODEX_DECK_REAL_CLI -PathType Leaf)) {
    throw "Real Codex CLI not found at $env:CODEX_DECK_REAL_CLI"
}

Push-Location $root
try {
    & $node --experimental-sea-config (Join-Path $root 'sea-config.json')
    if ($LASTEXITCODE -ne 0) { throw "Node SEA preparation failed with exit code $LASTEXITCODE" }

    Copy-Item -LiteralPath $node -Destination $output -Force
    & $node (Join-Path $root 'scripts\strip-authenticode.cjs') $output
    if ($LASTEXITCODE -ne 0) { throw "Authenticode removal failed with exit code $LASTEXITCODE" }

    & (Join-Path $root 'node_modules\.bin\postject.cmd') `
        $output NODE_SEA_BLOB $blob `
        --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
    if ($LASTEXITCODE -ne 0) { throw "Node SEA injection failed with exit code $LASTEXITCODE" }

}
finally {
    Pop-Location
}

$versionOutput = @(& $output --version 2>&1)
if ($LASTEXITCODE -ne 0) {
    throw "Transport smoke test failed with exit code $LASTEXITCODE`: $($versionOutput -join [Environment]::NewLine)"
}
$version = ($versionOutput -join [Environment]::NewLine).Trim()
if (-not $version.StartsWith('codex-cli ')) {
    throw "Unexpected delegated version output: $version"
}
Write-Host "Built Codex Deck transport: $output ($version)"
