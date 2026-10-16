# Design docs

Internal, contributor-facing documentation. The public, user-facing docs
site lives in `docs/` (Astro Starlight) and is written from these once the
code exists.

| Doc | What's in it |
|-----|--------------|
| [architecture.md](architecture.md) | Goals, components, request flow, session lifecycle, emulator internals, VPN, security model |
| [contracts.md](contracts.md) | HTTP contracts between services (Source, Provider, Agent) and the UI API, configuration and secret references |
| [roadmap.md](roadmap.md) | Phased work plan with checkboxes — the to-do list for agents |
| [decisions.md](decisions.md) | Architecture decision log (why Go, why Frida, why a sing-box sidecar, …) |
