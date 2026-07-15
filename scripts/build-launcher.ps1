$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'launcher\CodexDeck.Launcher.csproj'
$output = Join-Path $env:LOCALAPPDATA 'CodexDeck\build\launcher'
$launcher = Join-Path $output 'codex-deck-launcher.exe'
$transport = Join-Path $env:LOCALAPPDATA 'CodexDeck\build\codex-deck-transport.exe'
$buildRealCli = Join-Path $env:LOCALAPPDATA 'CodexDeck\build\codex-real-build.exe'

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw 'The .NET SDK is required to build the windowless launcher.'
}
if (-not (Test-Path -LiteralPath $transport -PathType Leaf)) {
    throw "Build the transport before the launcher: $transport"
}
if (-not $env:CODEX_DECK_REAL_CLI -and (Test-Path -LiteralPath $buildRealCli -PathType Leaf)) {
    $env:CODEX_DECK_REAL_CLI = $buildRealCli
}
if (-not $env:CODEX_DECK_REAL_CLI) {
    throw 'CODEX_DECK_REAL_CLI is not set and the local build copy is missing.'
}

$env:DOTNET_NOLOGO = '1'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
& dotnet publish $project `
    --configuration Release `
    --output $output `
    --nologo `
    --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw "Windowless launcher build failed with exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw "Windowless launcher output not found at $launcher"
}

$previousTransport = $env:CODEX_DECK_TRANSPORT_PATH
$env:CODEX_DECK_TRANSPORT_PATH = $transport
$stdout = Join-Path $env:TEMP ("codex-deck-launcher-" + [guid]::NewGuid().ToString('N') + '.out')
$stderr = Join-Path $env:TEMP ("codex-deck-launcher-" + [guid]::NewGuid().ToString('N') + '.err')
try {
    $process = Start-Process `
        -FilePath $launcher `
        -ArgumentList '--version' `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -Wait `
        -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Windowless launcher smoke test failed with exit code $($process.ExitCode): $(Get-Content -Raw $stderr)"
    }
    $version = (Get-Content -Raw $stdout).Trim()
    if (-not $version.StartsWith('codex-cli ')) {
        throw "Unexpected launcher version output: $version"
    }
    Write-Host "Built windowless Codex Deck launcher: $launcher ($version)"
}
finally {
    $env:CODEX_DECK_TRANSPORT_PATH = $previousTransport
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
}
