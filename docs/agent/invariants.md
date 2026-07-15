# Invariants (for agents)

These are the load-bearing safety and correctness rules. A change that violates
one is wrong even if tests pass. Each rule names its authority — read that
section before touching the relevant code.

## Security invariants

Canonical list: [`../../SECURITY.md`](../../SECURITY.md) §"Security invariants".

1. **Loopback-only.** The app-server WebSocket stays bound to `127.0.0.1`. The
   project does not support non-loopback binding.
2. **Approvals fail closed.** Only the allowlisted approval methods in
   `src/transport.cjs` (`APPROVAL_METHODS`) are actionable; unknown methods are
   rejected. Never broaden a requested permission, enable auto-approval, or
   persist an approval across tasks. Only the newest observed pending approval
   is answerable.
3. **Permission scope.** A permission approval returns only the permission shape
   Codex requested and stays turn-scoped; a decline returns an empty set.
4. **CLI is copied, never patched.** The packaged `codex.exe` is copied into
   `%LOCALAPPDATA%\CodexDeck\runtime` and hash-compared. The original package is
   never modified.
5. **Confined installer writes.** Recursive installer changes stay inside
   verified child paths.
6. **No secrets in the tree.** Credentials, task content, device identifiers,
   logs, recovery output, and local runtime binaries stay untracked (`.gitignore`).
7. **Disable path stays intact.** `scripts\disable-shim.ps1` must always be able
   to remove the shim variables and relaunch stock Codex.

## Protocol / behavior invariants

Authority: [`../reverse-engineering.md`](../reverse-engineering.md) and
[`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) §"Protocol changes".

- **Prefer generated schemas.** Generate app-server schemas from the *installed*
  CLI (`codex app-server generate-json-schema`) and validate request/response
  shapes against them rather than hand-authoring payloads.
- **No silent automation fallback.** Never add keyboard/mouse automation, UI
  scraping, or HID emulation as a fallback path.
- **Don't target background tasks.** Ephemeral and system-sourced tasks must
  never become dial/button targets. Preserve the target-selection hierarchy
  (see [`architecture.md`](architecture.md)); refusing an operation is safer than
  acting on the wrong task.
- **Answer approvals on the originating connection.** Approval responses go back
  on the desktop bridge connection that received the request — never fabricated
  as an unrelated peer request.
- **New tasks defer persistence.** Use the `codex://threads/new` deep link;
  don't create empty tasks over RPC (they have no rollout).
- **Treat desktop contracts as version-specific.** `CODEX_CLI_PATH`, `codex://`
  deep links, and archive findings are observed behavior, not stable API. Add or
  update a probe/test when you rely on one, and record the assumption in
  `reverse-engineering.md`.

## Hardware profile contract

Authority: [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) §"Artwork and profiles".

The default Stream Deck + layout must stay: six working action keys, two blank
keys, Brainpower on dial 1, Model on dial 2, dials 3–4 unused. Keep action
artwork distinct at both action-list and hardware sizes; don't include
third-party logos or imitate first-party device branding.

## Verification gate

Before submitting: `npm test`, `npm run validate`, `npm run pack`. For launcher,
transport, controller, profile, or installer changes, also `npm run install:local`
and `npm run diagnose` on real hardware. Details in [`workflows.md`](workflows.md).
