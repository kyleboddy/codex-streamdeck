# Security policy

## Supported versions

Security fixes are applied to the current `main` branch. Until stable releases are published, no older snapshot should be assumed supported.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose Codex credentials, allow unauthorized local control, broaden approvals, execute an unintended URI, or escape the loopback/local-machine boundary.

Use [GitHub private vulnerability reporting](https://github.com/kyleboddy/codex-streamdeck/security/advisories/new) when it is available for the repository. Include:

- affected commit or release;
- Codex app and CLI versions;
- Stream Deck software version;
- a minimal reproduction;
- the expected security boundary; and
- redacted diagnostic evidence.

Do not include access tokens, account data, task content, private repository content, device serials, or unredacted local paths.

## Local threat model

Codex Command Center is designed for a single-user Windows workstation. Its main boundaries are:

- a Codex app-server WebSocket bound to `127.0.0.1`;
- the local named pipe `\\.\pipe\codex-deck-control`;
- user-scoped environment variables selecting the shim;
- user-local runtime files under `%LOCALAPPDATA%\CodexDeck`; and
- the installed Stream Deck plugin under the user's Elgato data directory.

The project does not read OpenAI credentials. It joins the already authenticated app-server launched for Codex desktop. It does not remove Codex approval prompts; the physical Approve and Decline keys respond only to recognized pending requests.

A malicious process running as the same Windows user may be able to reach local IPC endpoints or modify user-local files. Do not use this project as a privilege boundary, expose the WebSocket listener on another interface, or install it on an untrusted multi-user host.

## Security invariants

Contributions must preserve these rules:

1. The app-server listener remains loopback-only.
2. Unknown approval methods fail closed.
3. Permission approvals never exceed the permissions requested by Codex and remain turn-scoped.
4. The real packaged Codex CLI is copied and hash-compared, not patched.
5. Recursive installer changes are confined to verified child paths.
6. Credentials, task content, device identifiers, logs, recovery output, and local runtime binaries remain untracked.
7. Disabling the shim remains possible with `scripts\disable-shim.ps1`.

## Recovery

If you suspect the shim or local plugin is behaving unexpectedly, stop using the hardware controls and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\disable-shim.ps1
```

This clears the user-scoped shim variables and relaunches the normally packaged Codex app. It does not delete Codex or modify the application package.
