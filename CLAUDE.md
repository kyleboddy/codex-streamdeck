# Codex Command Center — agent guide

A hardware control surface that drives the **Codex Windows desktop app** from an
ordinary **Elgato Stream Deck +**: six task keys, a reasoning-effort dial
("Brainpower"), and a live model dial. It works by joining Codex's own
app-server as a second client — no hotkeys, UI scraping, USB emulation, or
patched binaries.

> This is an **exploratory, version-sensitive interoperability project**, not a
> supported product. It depends on empirically observed Codex desktop behavior
> (`CODEX_CLI_PATH`, `codex://` deep links, app-server schemas) that can change
> between releases. Treat protocol claims as observations tied to reproducible
> evidence, and re-verify against the installed CLI before relying on them.

## Orientation (WHAT / where things live)

| Path | What it is |
| --- | --- |
| `src/transport.cjs` | Node transport + desktop bridge: delegates ordinary CLI calls, bridges desktop JSONL ↔ loopback WebSocket, hosts the `\\.\pipe\codex-deck-control` named pipe, tracks approval/active-task state. Packaged as a Node SEA. |
| `launcher/Program.cs` | .NET 10 `WinExe` launcher — starts the transport windowless and pumps stdio. The root of the headless process tree. |
| `com.driveline.codex-command-center.sdPlugin/` | Elgato SDK v2 plugin (manifest, artwork, profile). Source lives in `bin/`. |
| `…/bin/plugin.js` | Plugin entry: registers the key actions, `ReasoningDial`, and `ModelDial`. |
| `…/bin/controller.js` | Model/effort selection policy, target-task selection, direct actions, config cache. `EFFORTS` and the selection hierarchy live here. |
| `…/bin/codex-client.js` | WebSocket app-server client (`initialize`, `model/list`, RPC). |
| `profile-src/` | Source Stream Deck + profile; `scripts/build-profile.ps1` injects the device UUID at install. |
| `scripts/*.ps1` | Build, install, diagnose, and recovery scripts (see `docs/agent/workflows.md`). |
| `test/*.test.mjs` | Portable `node --test` suites (controller, feedback, layout). |
| `research/*.mjs` | Read-only protocol probes used during reverse engineering. |

## Why the architecture is shaped this way (WHY)

The central finding: **live task settings are process-local**. A second,
independent app-server can read persisted tasks but cannot mutate the task the
desktop already loaded. So the desktop and the plugin must share **one** real
app-server. Codex desktop is launched through a windowless shim
(`CODEX_CLI_PATH` → launcher → transport) that keeps its expected stdin/stdout
contract while starting the unmodified, version-matched CLI as a loopback
WebSocket server. The plugin joins as a peer; a narrow local pipe carries only
connection-bound operations (approvals, active-task state, review/interrupt).

Full rationale, experiments, and the protocol map: **`docs/reverse-engineering.md`**.

## How to work here (HOW)

Windows 10/11 only. PowerShell, Node.js 24+, .NET SDK 10. Runtime state lives
under `%LOCALAPPDATA%\CodexDeck`.

Portable checks (run before every change; safe on any machine, no hardware):

```powershell
npm test
npm run validate
npm run pack
```

Integration build (needs the installed Codex package + a connected Stream Deck +):

```powershell
npm run install:local
npm run diagnose
```

Command reference, what each script does, and when to run the integration pass:
**`docs/agent/workflows.md`**.

## Invariants — do not break these

These are load-bearing safety and correctness rules; each has an authority doc.

- App-server WebSocket stays **loopback-only** (`127.0.0.1`).
- Unknown approval methods **fail closed**; never broaden a requested
  permission, auto-approve, or persist an approval across tasks.
- The packaged Codex CLI is **copied and hash-compared, never patched**.
- No keyboard/mouse automation as a silent fallback.
- Prefer app-server schemas **generated from the installed CLI** over
  hand-authored request shapes.
- Never commit `dist/`, build output, logs, recovery bundles, device profiles
  containing UUIDs, or local runtime copies of Codex.
- Keep diagnostics redacted: no workspace paths, task content, account details,
  or device serials.

Full list and reporting: `SECURITY.md`. Contribution/PR expectations:
`CONTRIBUTING.md`.

## Read before deeper work (progressive disclosure)

- `docs/agent/architecture.md` — runtime topology and which file owns what.
- `docs/agent/workflows.md` — build/test/install/diagnose/recovery, in detail.
- `docs/agent/invariants.md` — the safety + protocol contract, with pointers.
- `docs/reverse-engineering.md` — the deep research record and protocol map.

Pull in only what the task needs.

<!-- AGENT-MANAGED SECTION -->
<!-- Claude and other agents may append discovered patterns and gotchas below. -->
<!-- Keep entries short; point to source with file:line instead of pasting code. -->

## Discovered patterns

_(none yet)_
