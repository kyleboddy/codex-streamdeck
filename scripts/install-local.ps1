param(
    [switch] $SkipCodexRestart,
    [switch] $SkipStreamDeckRestart
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$pluginName = 'com.driveline.codex-command-center.sdPlugin'
$pluginSource = Join-Path $root $pluginName
$profileId = 'B70D27A4-6A71-4C7A-942D-2A90FA660C2A.sdProfile'
$profileSource = Join-Path $root "profile-src\$profileId"
$streamDeckRoot = Join-Path $env:APPDATA 'Elgato\StreamDeck'
$pluginsRoot = Join-Path $streamDeckRoot 'Plugins'
$profilesRoot = Join-Path $streamDeckRoot 'ProfilesV3'
$pluginDestination = Join-Path $pluginsRoot $pluginName
$profileDestination = Join-Path $profilesRoot $profileId
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'CodexDeck'
$binRoot = Join-Path $runtimeRoot 'bin'
$realCliRoot = Join-Path $runtimeRoot 'runtime'
$configurationPath = Join-Path $runtimeRoot 'deck-config.json'
$installationPath = Join-Path $runtimeRoot 'installation.json'
$streamDeckExe = 'C:\Program Files\Elgato\StreamDeck\StreamDeck.exe'

function Assert-ChildPath {
    param(
        [Parameter(Mandatory)] [string] $Parent,
        [Parameter(Mandatory)] [string] $Child
    )

    $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    $childFull = [IO.Path]::GetFullPath($Child)
    if (-not $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify $childFull because it is outside $parentFull"
    }
}

function Write-Utf8Json {
    param(
        [Parameter(Mandatory)] $Value,
        [Parameter(Mandatory)] [string] $Path
    )

    $json = $Value | ConvertTo-Json -Depth 30
    [IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function Set-CodexDeckEnvironment {
    param(
        [Parameter(Mandatory)] [string] $Launcher,
        [Parameter(Mandatory)] [string] $Transport,
        [Parameter(Mandatory)] [string] $RealCli
    )

    $values = [ordered]@{
        CODEX_CLI_PATH = $Launcher
        CODEX_DECK_TRANSPORT_PATH = $Transport
        CODEX_DECK_REAL_CLI = $RealCli
        CODEX_DECK_SERVER_URL = 'ws://127.0.0.1:47812'
    }
    foreach ($entry in $values.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'User')
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }

    if (-not ('CodexDeck.EnvironmentBroadcast' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace CodexDeck {
    public static class EnvironmentBroadcast {
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr SendMessageTimeout(
            IntPtr window, uint message, IntPtr wParam, string lParam,
            uint flags, uint timeout, out IntPtr result);
    }
}
'@
    }
    $result = [IntPtr]::Zero
    [void][CodexDeck.EnvironmentBroadcast]::SendMessageTimeout(
        [IntPtr]0xffff, 0x001a, [IntPtr]::Zero, 'Environment', 0x0002, 5000, [ref]$result
    )
}

foreach ($directory in @($pluginsRoot, $profilesRoot, $runtimeRoot, $binRoot, $realCliRoot)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

Assert-ChildPath -Parent $pluginsRoot -Child $pluginDestination
Assert-ChildPath -Parent $profilesRoot -Child $profileDestination
Assert-ChildPath -Parent $runtimeRoot -Child $binRoot
Assert-ChildPath -Parent $runtimeRoot -Child $realCliRoot

$codexPackage = Get-AppxPackage OpenAI.Codex |
    Sort-Object Version -Descending |
    Select-Object -First 1
if (-not $codexPackage) { throw 'The Codex Windows app is not installed.' }

$realCliSource = Join-Path $codexPackage.InstallLocation 'app\resources\codex.exe'
$codexAppExe = Join-Path $codexPackage.InstallLocation 'app\ChatGPT.exe'
if (-not (Test-Path -LiteralPath $realCliSource -PathType Leaf)) {
    throw "Codex app-server executable not found at $realCliSource"
}
if (-not (Test-Path -LiteralPath $codexAppExe -PathType Leaf)) {
    throw "Codex desktop executable not found at $codexAppExe"
}
if (-not (Test-Path -LiteralPath $streamDeckExe -PathType Leaf)) {
    throw "Stream Deck 7.5 executable not found at $streamDeckExe"
}

$packageVersion = $codexPackage.Version.ToString()
$realCliDestination = Join-Path $realCliRoot "codex-real-$packageVersion.exe"
if (
    -not (Test-Path -LiteralPath $realCliDestination -PathType Leaf) -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $realCliSource).Hash -ne
        (Get-FileHash -Algorithm SHA256 -LiteralPath $realCliDestination).Hash
) {
    Copy-Item -LiteralPath $realCliSource -Destination $realCliDestination -Force
}
$env:CODEX_DECK_REAL_CLI = $realCliDestination

Push-Location $root
try {
    & npm.cmd ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "Root npm install failed with exit code $LASTEXITCODE" }
    & npm.cmd --prefix $pluginSource ci --omit=dev --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "Plugin npm install failed with exit code $LASTEXITCODE" }
    & (Join-Path $root 'scripts\build-transport.ps1')
    & (Join-Path $root 'scripts\build-launcher.ps1')
    & (Join-Path $root 'scripts\generate-assets.ps1')
    & (Join-Path $root 'scripts\build-profile.ps1')
}
finally {
    Pop-Location
}

$builtTransport = Join-Path $runtimeRoot 'build\codex-deck-transport.exe'
if (-not (Test-Path -LiteralPath $builtTransport -PathType Leaf)) {
    throw "Transport build output not found at $builtTransport"
}
$transportHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $builtTransport).Hash.Substring(0, 12).ToLowerInvariant()
$transportDestination = Join-Path $binRoot "codex-deck-transport-$transportHash.exe"
if (Test-Path -LiteralPath $transportDestination -PathType Leaf) {
    if (
        (Get-FileHash -Algorithm SHA256 -LiteralPath $builtTransport).Hash -ne
        (Get-FileHash -Algorithm SHA256 -LiteralPath $transportDestination).Hash
    ) {
        throw "Transport hash-prefix collision at $transportDestination"
    }
}
else {
    Copy-Item -LiteralPath $builtTransport -Destination $transportDestination
}
$builtLauncher = Join-Path $runtimeRoot 'build\launcher\codex-deck-launcher.exe'
if (-not (Test-Path -LiteralPath $builtLauncher -PathType Leaf)) {
    throw "Windowless launcher build output not found at $builtLauncher"
}
$launcherHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $builtLauncher).Hash.Substring(0, 12).ToLowerInvariant()
$launcherDestinationRoot = Join-Path $binRoot "launcher-$launcherHash"
Assert-ChildPath -Parent $binRoot -Child $launcherDestinationRoot
if (Test-Path -LiteralPath $launcherDestinationRoot) {
    $existingLauncher = Join-Path $launcherDestinationRoot 'codex-deck-launcher.exe'
    if (
        -not (Test-Path -LiteralPath $existingLauncher -PathType Leaf) -or
        (Get-FileHash -Algorithm SHA256 -LiteralPath $builtLauncher).Hash -ne
            (Get-FileHash -Algorithm SHA256 -LiteralPath $existingLauncher).Hash
    ) {
        throw "Launcher hash-prefix collision at $launcherDestinationRoot"
    }
}
else {
    Copy-Item -LiteralPath (Join-Path $runtimeRoot 'build\launcher') -Destination $launcherDestinationRoot -Recurse
}
$launcherDestination = Join-Path $launcherDestinationRoot 'codex-deck-launcher.exe'
if (-not (Test-Path -LiteralPath $launcherDestination -PathType Leaf)) {
    throw "Installed windowless launcher not found at $launcherDestination"
}
Set-CodexDeckEnvironment `
    -Launcher $launcherDestination `
    -Transport $transportDestination `
    -RealCli $realCliDestination

if (-not (Test-Path -LiteralPath $configurationPath -PathType Leaf)) {
    Copy-Item -LiteralPath (Join-Path $root 'config\deck-config.json') -Destination $configurationPath
}

$physicalManifest = Get-ChildItem $profilesRoot -Directory |
    Where-Object { $_.FullName -ne $profileDestination } |
    ForEach-Object {
        $manifestPath = Join-Path $_.FullName 'manifest.json'
        if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
            $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
            if ($manifest.Device.Model -eq '20GBD9901' -and $manifest.Device.UUID) {
                [pscustomobject]@{ Path = $manifestPath; Manifest = $manifest }
            }
        }
    } |
    Select-Object -First 1
if (-not $physicalManifest) {
    throw 'A Stream Deck + device profile was not found; no hardware profile was replaced.'
}

if (-not $SkipStreamDeckRestart) {
    Get-Process StreamDeck -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 500
}

if (Test-Path -LiteralPath $pluginDestination) {
    Remove-Item -LiteralPath $pluginDestination -Recurse -Force
}
Copy-Item -LiteralPath $pluginSource -Destination $pluginDestination -Recurse

if (Test-Path -LiteralPath $profileDestination) {
    Remove-Item -LiteralPath $profileDestination -Recurse -Force
}
Copy-Item -LiteralPath $profileSource -Destination $profileDestination -Recurse
$installedProfileManifestPath = Join-Path $profileDestination 'manifest.json'
$installedProfileManifest = Get-Content -Raw -LiteralPath $installedProfileManifestPath | ConvertFrom-Json
$installedProfileManifest.Device.UUID = $physicalManifest.Manifest.Device.UUID
Write-Utf8Json -Value $installedProfileManifest -Path $installedProfileManifestPath

$installation = [ordered]@{
    installedAt = [DateTimeOffset]::Now.ToString('o')
    codexPackageVersion = $packageVersion
    codexApp = $codexAppExe
    realCli = $realCliDestination
    launcher = $launcherDestination
    launcherRoot = $launcherDestinationRoot
    transport = $transportDestination
    serverUrl = 'ws://127.0.0.1:47812'
    plugin = $pluginDestination
    profile = $profileDestination
    deviceUuid = $physicalManifest.Manifest.Device.UUID
}
Write-Utf8Json -Value $installation -Path $installationPath

if (-not $SkipStreamDeckRestart) {
    Start-Process -FilePath $streamDeckExe -WindowStyle Hidden
}

if (-not $SkipCodexRestart) {
    & (Join-Path $root 'scripts\restart-codex.ps1')
}

Write-Host "Installed Codex Command Center 1.0.0 for Stream Deck +."
Write-Host "Windowless launcher: $launcherDestination"
Write-Host "Protocol transport: $transportDestination"
Write-Host "Configuration: $configurationPath"
if ($SkipCodexRestart) {
    Write-Host 'Codex restart was deferred; the new transport becomes active on the next Codex launch.'
}
