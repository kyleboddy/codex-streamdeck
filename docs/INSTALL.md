# Installing Codex Command Center

> This is an experimental integration. It works against a specific version
> snapshot (see [Compatibility](#compatibility)) and may break when Codex
> updates. Read [`reverse-engineering.md`](reverse-engineering.md) if something
> behaves unexpectedly.

## Prerequisites

- Windows 10 or 11
- Elgato Stream Deck + and Stream Deck software 7.5
- The Codex Windows app
- [Node.js](https://nodejs.org/) 24 or newer
- [.NET SDK](https://dotnet.microsoft.com/download) 10

## Install locally

```powershell
git clone https://github.com/kyleboddy/codex-streamdeck.git
Set-Location codex-streamdeck
npm run install:local
```

The installer restarts Stream Deck and schedules a windowless Codex restart so
the new transport takes effect — save any unfinished input first. Existing
`%LOCALAPPDATA%\CodexDeck\deck-config.json` customizations are preserved.

To install while leaving the running Codex process alone (it takes effect next
launch):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-local.ps1 -SkipCodexRestart
```

### What the installer changes

1. Locates the installed Codex package and copies its exact CLI into a
   versioned user-local runtime directory.
2. Builds and smoke-tests the windowless launcher and single-executable transport.
3. Builds the Stream Deck profile and production image sizes.
4. Installs the plugin and profile under Elgato's roaming-data directories.
5. Sets four user-scoped environment variables: `CODEX_CLI_PATH`,
   `CODEX_DECK_TRANSPORT_PATH`, `CODEX_DECK_REAL_CLI`, `CODEX_DECK_SERVER_URL`.
6. Restarts the applications unless a skip switch is supplied.

Runtime state, configuration, and logs live under `%LOCALAPPDATA%\CodexDeck`. No
cloud service, API key, or separate OpenAI session is required.

## Default hardware layout

| Position | Control | Behavior |
| --- | --- | --- |
| Key 1 | **New Task** | Opens Codex's native empty composer for the active workspace. |
| Key 2 | **Review Changes** | Starts an inline review of uncommitted changes in the active task. |
| Key 3 | **Approve** | Accepts the newest pending approval request on the desktop connection. |
| Key 4 | **Decline** | Declines that pending request. |
| Key 5 | **Stop** | Interrupts the active Codex turn. |
| Key 6 | **Fork** | Forks the active task and opens the new task. |
| Keys 7–8 | **Custom slots** | Blank by default; configured in one local JSON file. |
| Dial 1 | **Brainpower** | Light, Medium, High, Extra High, Max, Ultra. Push resets to High. |
| Dial 2 | **Model** | Rotates through the live model catalog. Push refreshes and selects the preferred model. |
| Dials 3–4 | **Open** | Deliberately unused. |

The model dial calls `model/list` at runtime rather than shipping a stale model
table. If a selected effort is unsupported by the current model, the controller
switches to the first live model advertising that effort.

## Configure the blank keys

Edit `%LOCALAPPDATA%\CodexDeck\deck-config.json`. A slot can stay blank, open a
URI, or invoke a built-in action name: `new-task`, `review`, `approve`,
`decline`, `stop`, `fork`, `skills`, or `settings`.

```json
{
  "blanks": {
    "blank1": { "title": "Docs", "type": "uri", "value": "https://developers.openai.com/codex/" },
    "blank2": { "title": "Skills", "type": "action", "value": "skills" }
  }
}
```

Restart Stream Deck after changing slot titles. Invalid values and recursive
custom actions are rejected with Stream Deck's alert indicator.

## Develop and package

```powershell
npm ci --ignore-scripts
npm --prefix com.driveline.codex-command-center.sdPlugin ci --omit=dev --ignore-scripts
```

| Command | Purpose |
| --- | --- |
| `npm run build` | Generate assets/profile and build the transport plus launcher. |
| `npm test` | Run controller, feedback, and layout tests. |
| `npm run validate` | Validate the plugin with Elgato's CLI. |
| `npm run pack` | Create `dist/*.streamDeckPlugin`. |
| `npm run diagnose` | Inspect the local install, processes, device, models, and effort catalog. |
| `npm run install:local` | Build, install, and activate the complete integration. |

GitHub Actions runs the portable tests, Elgato validation, and packaging on
Windows. A full integration build stays a local hardware test — it needs the
installed Codex package, its matching CLI, and a Stream Deck + profile.

The `.streamDeckPlugin` artifact contains the Elgato plugin and profile, but it
is **not** a standalone Codex shim installer. Direct model, reasoning, task, and
approval control still requires `npm run install:local` on the target machine.

## Verification

Before submitting a change:

```powershell
npm test
npm run validate
npm run pack
```

For transport, launcher, model, effort, or approval changes, also run
`npm run install:local` and `npm run diagnose`, then verify the affected
controls on physical hardware. Do not commit diagnostics containing private
workspace paths, task content, account details, or device serials.

## Disable or recover

To remove the user-level shim variables and relaunch the normally packaged Codex
app:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\disable-shim.ps1
```

This does not uninstall Codex or alter its packaged CLI. Run
`npm run install:local` again to reactivate.

After a Codex desktop update, rerun the installer so the user-local real-CLI
copy stays aligned with the application. If behavior changes after an update,
capture redacted `npm run diagnose` output and open a
[bug report](https://github.com/kyleboddy/codex-streamdeck/issues/new/choose).

## Compatibility

Last verified on **July 15, 2026** with:

- Codex Windows app `26.707.9981.0`
- Codex CLI `0.144.2`
- Stream Deck software `7.5.0.22885`
- Elgato Stream Deck +

The model catalog and supported effort levels are discovered at runtime, so the
hardware follows catalog changes without a plugin release. The `CODEX_CLI_PATH`
override, `codex://` deep links, and some desktop-connection behavior are
empirically discovered and may change between Codex releases. Treat Codex
desktop and CLI as a matched pair: after a desktop update, rerun the installer.
