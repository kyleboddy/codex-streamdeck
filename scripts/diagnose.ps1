param(
    [switch] $RequireActive,
    [switch] $AsJson
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'CodexDeck'
$installationPath = Join-Path $runtimeRoot 'installation.json'
$streamDeckExe = 'C:\Program Files\Elgato\StreamDeck\StreamDeck.exe'
$checks = [Collections.Generic.List[object]]::new()

function Add-Check {
    param([string] $Name, [string] $Status, [string] $Details)
    $checks.Add([pscustomobject]@{ Check = $Name; Status = $Status; Details = $Details })
}

function Active-Status {
    if ($RequireActive) { return 'FAIL' }
    return 'WARN'
}

$installation = $null
if (Test-Path -LiteralPath $installationPath -PathType Leaf) {
    $installation = Get-Content -Raw -LiteralPath $installationPath | ConvertFrom-Json
    Add-Check 'Installation manifest' 'PASS' $installationPath
}
else {
    Add-Check 'Installation manifest' 'FAIL' "Missing: $installationPath"
}

$environment = [ordered]@{}
foreach ($name in @('CODEX_CLI_PATH', 'CODEX_DECK_TRANSPORT_PATH', 'CODEX_DECK_REAL_CLI', 'CODEX_DECK_SERVER_URL')) {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    $environment[$name] = $value
    if ($value) {
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        Add-Check "Environment $name" 'PASS' $value
    }
    else {
        Add-Check "Environment $name" 'FAIL' 'User value is not set'
    }
}

foreach ($entry in @(
    @{ Name = 'Windowless launcher'; Path = $environment.CODEX_CLI_PATH },
    @{ Name = 'Protocol transport'; Path = $environment.CODEX_DECK_TRANSPORT_PATH },
    @{ Name = 'Real Codex CLI'; Path = $environment.CODEX_DECK_REAL_CLI }
)) {
    if ($entry.Path -and (Test-Path -LiteralPath $entry.Path -PathType Leaf)) {
        Add-Check $entry.Name 'PASS' $entry.Path
    }
    else {
        Add-Check $entry.Name 'FAIL' "Missing: $($entry.Path)"
    }
}

if ($environment.CODEX_CLI_PATH -and (Test-Path -LiteralPath $environment.CODEX_CLI_PATH)) {
    $bytes = [IO.File]::ReadAllBytes($environment.CODEX_CLI_PATH)
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
    $subsystem = [BitConverter]::ToUInt16($bytes, $peOffset + 24 + 68)
    if ($subsystem -eq 2) {
        Add-Check 'Launcher window mode' 'PASS' 'PE subsystem is Windows GUI; no console can be created'
    }
    else {
        Add-Check 'Launcher window mode' 'FAIL' "Unexpected PE subsystem: $subsystem"
    }
}

if (Test-Path -LiteralPath $streamDeckExe -PathType Leaf) {
    $streamDeckVersion = (Get-Item -LiteralPath $streamDeckExe).VersionInfo.ProductVersion
    Add-Check 'Stream Deck software' 'PASS' "Version $streamDeckVersion"
}
else {
    Add-Check 'Stream Deck software' 'FAIL' "Missing: $streamDeckExe"
}

$streamDeckProcess = Get-Process StreamDeck -ErrorAction SilentlyContinue | Select-Object -First 1
if ($streamDeckProcess) {
    Add-Check 'Stream Deck process' 'PASS' "PID $($streamDeckProcess.Id)"
}
else {
    Add-Check 'Stream Deck process' (Active-Status) 'Stream Deck is not running'
}

$device = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
    Where-Object { $_.DeviceID -like 'USB\VID_0FD9*' -and $_.Status -eq 'OK' } |
    Select-Object -First 1
if ($device) {
    Add-Check 'Elgato USB device' 'PASS' "$($device.Name) [$($device.DeviceID)]"
}
else {
    Add-Check 'Elgato USB device' 'FAIL' 'No healthy VID_0FD9 USB device is present'
}

$installedPlugin = Join-Path $env:APPDATA 'Elgato\StreamDeck\Plugins\com.driveline.codex-command-center.sdPlugin\manifest.json'
if (Test-Path -LiteralPath $installedPlugin -PathType Leaf) {
    $pluginManifest = Get-Content -Raw -LiteralPath $installedPlugin | ConvertFrom-Json
    Add-Check 'Installed plugin' 'PASS' "Version $($pluginManifest.Version); $($pluginManifest.Actions.Count) marketplace actions"
}
else {
    Add-Check 'Installed plugin' 'FAIL' "Missing: $installedPlugin"
}

$pluginProcess = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*com.driveline.codex-command-center.sdPlugin*' } |
    Select-Object -First 1
if ($pluginProcess) {
    Add-Check 'Plugin process' 'PASS' "PID $($pluginProcess.ProcessId)"
}
else {
    Add-Check 'Plugin process' (Active-Status) 'Stream Deck has not started the plugin process'
}

$listener = Get-NetTCPConnection -LocalPort 47812 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($listener) {
    Add-Check 'Codex app-server port' 'PASS' "127.0.0.1:47812 owned by PID $($listener.OwningProcess)"
}
else {
    Add-Check 'Codex app-server port' (Active-Status) 'Port 47812 is not listening'
}

$realProcess = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.ExecutablePath -and
        $environment.CODEX_DECK_REAL_CLI -and
        $_.ExecutablePath.Equals($environment.CODEX_DECK_REAL_CLI, [StringComparison]::OrdinalIgnoreCase)
    } |
    Select-Object -First 1
if ($realProcess) {
    $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $descendantIds = [Collections.Generic.HashSet[int]]::new()
    [void]$descendantIds.Add([int]$realProcess.ProcessId)
    do {
        $added = $false
        foreach ($process in $allProcesses) {
            if (
                $descendantIds.Contains([int]$process.ParentProcessId) -and
                $descendantIds.Add([int]$process.ProcessId)
            ) {
                $added = $true
            }
        }
    } while ($added)

    if (-not ('CodexDeck.WindowScan' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace CodexDeck {
    public static class WindowScan {
        public delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);
        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);
        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    }
}
'@
    }
    $visibleDescendants = [Collections.Generic.List[int]]::new()
    [CodexDeck.WindowScan]::EnumWindows({
        param($window, $state)
        if ([CodexDeck.WindowScan]::IsWindowVisible($window)) {
            [uint32]$windowProcessId = 0
            [void][CodexDeck.WindowScan]::GetWindowThreadProcessId($window, [ref]$windowProcessId)
            if ($descendantIds.Contains([int]$windowProcessId)) {
                $visibleDescendants.Add([int]$windowProcessId)
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null

    if ($visibleDescendants.Count -eq 0) {
        Add-Check 'Live console isolation' 'PASS' "PID $($realProcess.ProcessId); $($descendantIds.Count - 1) descendants; zero visible windows"
    }
    else {
        $visibleSummary = $visibleDescendants | Sort-Object -Unique | ForEach-Object {
            $process = $allProcesses | Where-Object ProcessId -eq $_ | Select-Object -First 1
            "$($process.Name) PID $_"
        }
        Add-Check 'Live console isolation' 'FAIL' ($visibleSummary -join '; ')
    }
}
else {
    Add-Check 'Live console isolation' (Active-Status) 'The shared real Codex app-server is not running'
}

$server = $null
if ($listener -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $serverOutput = @(& node (Join-Path $root 'scripts\check-server.mjs') 2>$null)
    $serverExit = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($serverExit -eq 0) {
        $server = ($serverOutput -join [Environment]::NewLine) | ConvertFrom-Json
        $modelSummary = $server.models | ForEach-Object {
            "$($_.displayName):$($_.supportedReasoningEfforts -join '/')"
        }
        $targetId = if ($server.targetThread.id) { $server.targetThread.id } else { 'none' }
        Add-Check 'Direct Codex protocol' 'PASS' "$($server.models.Count) models; hardware target $targetId; bridge state $($server.state.activeThreadId)"
        Add-Check 'Live effort catalog' 'PASS' ($modelSummary -join '; ')
    }
    else {
        Add-Check 'Direct Codex protocol' (Active-Status) ($serverOutput -join ' ')
    }
}

$result = [ordered]@{
    generatedAt = [DateTimeOffset]::Now.ToString('o')
    checks = $checks
    server = $server
}

if ($AsJson) {
    $result | ConvertTo-Json -Depth 12
}
else {
    $checks | Format-Table -AutoSize -Wrap
}

if ($checks.Status -contains 'FAIL') { exit 1 }
