<p align="center">
  <img src="docs/assets/codex-streamdeck-banner.png" alt="A Stream Deck Plus control surface routing two precision dials into an abstract AI reasoning core" width="100%">
</p>

<h1 align="center">Codex Command Center for Stream Deck +</h1>

<p align="center">
  A windowless hardware control surface for the Codex Windows app on an ordinary Elgato Stream Deck +.
</p>

<p align="center">
  <img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg">
  <img alt="Platform: Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4">
  <img alt="Hardware: Stream Deck Plus" src="https://img.shields.io/badge/hardware-Stream%20Deck%20%2B-111827">
</p>

> [!WARNING]
> **Experimental — a bridge, not a product.** This is a proof of concept that
> reverse-engineers version-sensitive Codex desktop behavior. It is unofficial
> and unaffiliated with OpenAI, Elgato, or Work Louder. It works on the author's
> machine against one version snapshot; it will **not** necessarily install or
> run automatically for you, and it can break when Codex updates. Use it as a
> starting point and a reference for how the integration works — not a turnkey
> install.

Six task keys act on the current Codex task; two rotary encoders choose live
models and reasoning effort. It joins Codex's own app-server as a second
client — no hotkeys, UI scraping, USB emulation, or patched binaries. The *why*
and *how* are documented below.

## Docs

- **[Install & use](docs/INSTALL.md)** — prerequisites, install, hardware layout, config, dev, recovery, compatibility.
- **[Reverse-engineering writeup](docs/reverse-engineering.md)** — the research record, protocol map, and design rationale.
- **[Agent guide](CLAUDE.md)** — orientation for coding agents, with deep-dives under [`docs/agent/`](docs/agent/).
- **[Contributing](CONTRIBUTING.md)** · **[Security](SECURITY.md)** · **[Changelog](CHANGELOG.md)**

## License

[Apache 2.0](LICENSE). Codex and OpenAI are trademarks of OpenAI, L.L.C.; Stream
Deck and Elgato of Corsair Memory, Inc.; Work Louder of Work Louder Inc. Product
names describe interoperability only. This is an independent community project.
