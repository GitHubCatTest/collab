# Roadmap

## v0.2.x Stabilization (In Progress)

Status date: 2026-03-05

### Milestone 1: CLI Surface and Adapter UX

- [x] Land new adapter CLI subcommands beyond `adapters list`.
- [x] Finalize `run` flag parsing for `--team`, `--debate-rounds`, `--require-evidence`.
- [x] Keep backwards compatibility for existing `run`/`chat`/`doctor` workflows.

### Milestone 2: Orchestration + Eventing

- [x] Add round/debate controls wired to v0.2 run flags.
- [x] Add evidence-requirement gating in orchestration flow.
- [x] Add event-stream coverage for role negotiation, disagreement, evidence checks, adapter health, and quality gates.

### Milestone 3: Release Quality

- [ ] Expand e2e fixtures across representative repos (Node, Python, mixed mono-repo).
- [ ] Improve budget/cost accounting by provider-specific token metadata when available.
- [ ] Add replay filters (`--type`, `--role`, `--round`) for large traces.

## v0.3.x Reliability and Scale

- Provider streaming support with structured partial events.
- Incremental context packing for large repositories.
- Advanced verification profiles and per-repo templates.
- Better degraded-mode fallbacks when one or more providers are unavailable.

## v1.0 Launch Readiness

- Public benchmark/eval report with reproducible fixtures.
- Demo sessions and onboarding guides for new contributors.
- Hardened release train (tag gating, changelog discipline, artifact signing).
- Cross-platform polish and expanded smoke coverage.
