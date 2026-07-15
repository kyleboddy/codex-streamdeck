# Architecture map (for agents)

A concise map of the runtime topology and which source file owns each concern.
For the full research record, experiments, and protocol map, read
[`../reverse-engineering.md`](../reverse-engineering.md) — this file points into
it rather than repeating it.

## Runtime topology

```
Codex desktop (ChatGPT.exe)
  │  JSONL stdin/stdout   (via CODEX_CLI_PATH)
  ▼
codex-deck-launcher.exe   .NET WinExe, headless root         launcher/Program.cs
  │  redirected byte streams
  ▼
codex-deck-transport.exe  Node SEA: bridge + delegate        src/transport.cjs
  │  WebSocket RPC (ws://127.0.0.1:47812)
  ▼
codex-real.exe  app-server --listen 127.0.0.1  (unmodified, version-matched copy)
  ▲
  │  WebSocket RPC (second client)
Stream Deck plugin  ─── \\.\pipe\codex-deck-control ───►  transport
  bin/plugin.js · bin/controller.js · bin/codex-client.js
```

The desktop and the plugin are **two clients of one real app-server**. The named
pipe carries only connection-bound operations (approvals, active-task state,
injected review/interrupt RPC).

## Who owns what

| Concern | Location |
| --- | --- |
| Launch transport windowless, pump stdio | `launcher/Program.cs` |
| Ordinary CLI delegation (strip `CODEX_CLI_PATH`, run real CLI) | `src/transport.cjs` — `shouldBridgeAppServer`, `cleanEnvironment`, `delegate` |
| Desktop JSONL ↔ WebSocket bridge, shared-server bootstrap lock | `src/transport.cjs` — server startup + `connectWebSocket` |
| Approval + thread-targeting method allowlists | `src/transport.cjs` — `APPROVAL_METHODS`, `THREAD_TARGETING_METHODS` |
| Named-pipe control (`state` / `rpc` / `approve` / `decline`) | `src/transport.cjs` — pipe server on `CONTROL_PIPE` |
| App-server connect / `initialize` / RPC / `model/list` | `com.driveline.codex-command-center.sdPlugin/bin/codex-client.js` — `CodexRpcClient` |
| Effort vocabulary + selection policy | `…/bin/controller.js` — `EFFORTS`, `CodexDeckController` |
| Target-task selection (reject ephemeral/system tasks) | `…/bin/controller.js` |
| Direct actions (new-task, review, approve, decline, stop, fork) | `…/bin/controller.js` + `…/bin/plugin.js` `CommandAction` |
| Encoder feedback + key success/error indication | `…/bin/plugin.js` (`ReasoningDial`, `ModelDial`), `…/bin/action-feedback.js` |
| Action/profile declaration (Keypad + Encoder controllers) | `…/manifest.json`, `profile-src/` |

## Key behaviors worth knowing

- **Model dial is dynamic.** The plugin never ships a static model table; it
  walks the live `model/list` catalog and rebuilds touch-strip options on
  connect and on `model/list/updated`. See `controller.js` `refreshModels`.
- **Persistence-first ordering.** A dial change writes the local selection
  cache, persists user config via `config/batchWrite`, *then* attempts a live
  `thread/settings/update`. This lets the native New Task composer inherit the
  selected defaults even with no active task.
- **New Task uses a deep link**, not `thread/start`. A task created without a
  submitted turn has no rollout ("no rollout found for thread id …"), so New
  Task opens `codex://threads/new?path=<workspace>` and lets Codex own creation
  timing.
- **Target selection is a hierarchy**, not "most recent": bridge-observed task →
  `thread/loaded/list` → recent unarchived tasks → refuse. Ephemeral/system
  tasks are always excluded. Details in `reverse-engineering.md` §"Target
  selection and background tasks".

## Protocol map

The full hardware-intent → RPC table (with parameters and behavior) lives in
[`../reverse-engineering.md`](../reverse-engineering.md) §"Protocol map". When
adding or changing an RPC method, regenerate schemas from the installed CLI
(`codex app-server generate-json-schema`) and prefer them over hand-authored
shapes — see [`invariants.md`](invariants.md).
