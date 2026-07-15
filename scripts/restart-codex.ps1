param([switch] $Worker)

$ErrorActionPreference = 'Stop'
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'CodexDeck'
$installationPath = Join-Path $runtimeRoot 'installation.json'
if (-not (Test-Path -LiteralPath $installationPath -PathType Leaf)) {
    throw "Installation manifest missing at $installationPath"
}

if (-not $Worker) {
    $source = "& '" + $PSCommandPath.Replace("'", "''") + "' -Worker"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($source))
    $powerShell = Join-Path $PSHOME 'powershell.exe'
    $created = Invoke-CimMethod `
        -ClassName Win32_Process `
        -MethodName Create `
        -Arguments @{
            CommandLine = "`"$powerShell`" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand $encoded"
        }
    if ($created.ReturnValue -ne 0) {
        throw "Could not schedule the out-of-process Codex restart (WMI code $($created.ReturnValue))."
    }
    Write-Host "Scheduled windowless Codex restart worker PID $($created.ProcessId)."
    return
}

Start-Sleep -Milliseconds 750
$installation = Get-Content -Raw -LiteralPath $installationPath | ConvertFrom-Json
foreach ($name in @('CODEX_CLI_PATH', 'CODEX_DECK_TRANSPORT_PATH', 'CODEX_DECK_REAL_CLI', 'CODEX_DECK_SERVER_URL')) {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if (-not $value) { throw "User environment variable $name is missing." }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}

$codexStartApp = Get-StartApps |
    Where-Object { $_.AppID -like 'OpenAI.Codex_*!*' -or $_.Name -eq 'Codex' } |
    Select-Object -First 1
if (-not $codexStartApp) {
    throw 'The packaged Codex Start-menu application could not be found.'
}

Get-Process ChatGPT -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 750
Get-CimInstance Win32_Process |
    Where-Object {
        $_.ExecutablePath -and
        $_.ExecutablePath.StartsWith((Join-Path $runtimeRoot 'runtime'), [StringComparison]::OrdinalIgnoreCase)
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') `
    -ArgumentList "shell:AppsFolder\$($codexStartApp.AppID)"
