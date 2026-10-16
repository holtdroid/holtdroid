# Design docs

Internal, contributor-facing documentation. The public, user-facing docs
site lives in `docs/` (Astro Starlight) and is written from these once the
code exists.

| Doc | What's in it |
|-----|--------------|
| [status.md](status.md) | **Start here when picking the work up:** what works, what's next, maintainer requirements, working agreements, known gotchas, the maintainer's deployment |
| [architecture.md](architecture.md) | Goals, components, request flow, session lifecycle, emulator internals, VPN, SSH access, security model, future Docker/physical providers |
| [contracts.md](contracts.md) | HTTP contracts between services (Source, Provider, Agent) and the UI API, configuration and secret references |
| [roadmap.md](roadmap.md) | Phased work plan with checkboxes — the to-do list for agents |
| [decisions.md](decisions.md) | Architecture decision log (why Go, why Frida, why a sing-box sidecar, …) |
