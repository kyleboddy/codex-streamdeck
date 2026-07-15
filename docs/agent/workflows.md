# Workflows (for agents)

Every command runs from the repo root in **PowerShell** on Windows 10/11.
Prerequisites: Node.js 24+, .NET SDK 10, the Codex Windows app, Stream Deck
software 7.5, and (for hardware passes) a connected Stream Deck +.

## Install dependencies

```powershell
npm ci --ignore-scripts
npm --prefix com.driveline.codex-command-center.sdPlugin ci --omit=dev --ignore-scripts
```

`--ignore-scripts` is deliberate — the build steps are explicit npm scripts, not
install hooks.

## Portable checks — run before every change

These need no Codex install and no hardware, and are what CI runs:

| Command | What it does | Script |
| --- | --- | --- |
| `npm test` | `node --test` over controller, feedback, and layout suites. | `test/*.test.mjs` |
| `npm run validate` | Validate the plugin against Elgato's CLI. | `@elgato/cli` |
| `npm run pack` | Build `dist/*.streamDeckPlugin`. | `@elgato/cli` |

## Build steps

`npm run build` runs these in order; each is also runnable alone:

| Command | Produces | Script |
| --- | --- | --- |
| `npm run assets` | Action artwork + production image sizes. | `scripts/generate-assets.ps1` |
| `npm run profile` | Stream Deck + profile from `profile-src/`. | `scripts/build-profile.ps1` |
| `npm run transport` | Node SEA transport binary. | `scripts/build-transport.ps1` |
| `npm run launcher` | .NET `WinExe` launcher. | `scripts/build-launcher.ps1` |

## Integration pass — needs Codex + hardware

Required for any change to the launcher, transport, controller, profile, or
installer:

```powershell
npm run install:local     # scripts/install-local.ps1
npm run diagnose          # scripts/diagnose.ps1
```

`install:local` copies the version-matched real CLI into
`%LOCALAPPDATA%\CodexDeck\runtime`, builds and smoke-tests the launcher +
transport, installs the plugin/profile, sets the four `CODEX_DECK_*` /
`CODEX_CLI_PATH` user environment variables, and restarts the apps.

To install without touching the running Codex process:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-local.ps1 -SkipCodexRestart
```

`diagnose` inspects the local install, processes, device, models, and effort
catalog. **Redact its output** before sharing — no workspace paths, task
content, account details, or device serials.

After a Codex desktop update, rerun `install:local` so the copied real CLI stays
aligned with the new package (a stale copy may carry incompatible schemas).

## Recovery / disable the shim

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\disable-shim.ps1
```

Clears the user-scoped shim variables and relaunches the normally packaged Codex
app. It does **not** uninstall Codex or modify its packaged CLI. Rerun
`install:local` to reactivate.

## Protocol / research probes

Read-only probes under `research/` reproduce the reverse-engineering findings
(cross-process state, multi-client sharing, transport bridge, live controller).
Run these in isolation before changing desktop-integration code — see
[`../reverse-engineering.md`](../reverse-engineering.md) §"Reproducing the
research".

## What not to commit

`dist/`, build output, installed plugins, logs, recovery bundles, device
profiles containing UUIDs, and local runtime copies of Codex. See `.gitignore`
and [`invariants.md`](invariants.md).
