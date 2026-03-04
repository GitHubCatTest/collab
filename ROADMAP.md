# Roadmap

## v0.2.x Stabilization

- Expand e2e fixtures across representative repos (Node, Python, mixed mono-repo).
- Add confidence scoring and disagreement mini-rounds for close arbiter decisions.
- Improve budget/cost accounting by provider-specific token metadata when available.
- Add replay filters (`--type`, `--role`, `--round`) for large traces.

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
