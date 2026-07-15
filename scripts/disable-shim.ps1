param(
    [switch] $Worker,
    [switch] $SkipCodexRestart
)

$ErrorActionPreference = 'Stop'
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'CodexDeck'
$names = @('CODEX_CLI_PATH', 'CODEX_DECK_TRANSPORT_PATH', 'CODEX_DECK_REAL_CLI', 'CODEX_DECK_SERVER_URL')

if (-not $Worker -and -not $SkipCodexRestart) {
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
        throw "Could not schedule the out-of-process Codex recovery (WMI code $($created.ReturnValue))."
    }
    Write-Host "Scheduled windowless Codex recovery worker PID $($created.ProcessId)."
    return
}

$codexStartApp = Get-StartApps |
    Where-Object { $_.AppID -like 'OpenAI.Codex_*!*' -or $_.Name -eq 'Codex' } |
    Select-Object -First 1
if (-not $SkipCodexRestart -and -not $codexStartApp) {
    throw 'The packaged Codex Start-menu application could not be found.'
}

foreach ($name in $names) {
    [Environment]::SetEnvironmentVariable($name, $null, 'User')
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
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

if ($SkipCodexRestart) {
    Write-Host 'Codex Deck shim disabled for future Codex launches.'
    return
}

Start-Sleep -Milliseconds 750
Get-Process ChatGPT -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 750
Get-CimInstance Win32_Process |
    Where-Object {
        $_.ExecutablePath -and
        $_.ExecutablePath.StartsWith($runtimeRoot, [StringComparison]::OrdinalIgnoreCase)
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') `
    -ArgumentList "shell:AppsFolder\$($codexStartApp.AppID)"
