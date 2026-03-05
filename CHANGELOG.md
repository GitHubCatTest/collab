# Changelog

## Unreleased

### MCP Migration Notes

#### Changed

- `meta.estimated_cost_usd` now uses a single project-wide heuristic in all MCP pipeline/provider paths:
  - input token rate: `0.000001` USD/token
  - output token rate: `0.000003` USD/token
- This aligns previously inconsistent cost math (the MoA pipeline had been reporting values 10x higher than provider-level estimates).
- Downstream telemetry consumers should treat this as a metrics-scale correction and re-baseline any budget/alert thresholds built on earlier values.

#### Compatibility

- `meta.models_used` and `meta.failed_models` continue to report provider IDs (`openai`, `anthropic`, `google`) for backward compatibility with progress-event correlation.

### v0.2 (In Progress)

#### Added

- Adapter runtime v2 fields: `outputFormat`, `testArgs`, `healthCheckArgs`, `env`.
- Adapter runtime JSON output parsing with normalization back into section format.
- Adapter runtime error taxonomy tags: `not-found`, `timeout`, `parse-failed`, `non-zero-exit`.
- Adapter CLI subcommands: `adapters test`, `adapters doctor`, `adapters init --preset tri-subscription`.
- Team-mode run controls: `--team auto|manual`, `--debate-rounds`, `--require-evidence`.
- Round-0 role negotiation with optional auto role remapping (`strengths_first` strategy).
- Disagreement signal events on close arbiter scores for transparent tie-break context.
- Quality-gate flow with evidence checks and optional unknown file-ref rejection.
- Event schema/runtime support for: `role_negotiation`, `disagreement_flag`, `evidence_check`, `adapter_health`, `quality_gate`.
- New helper scripts: `scripts/adapters/json-adapter-template.mjs`, `scripts/adapters/health-check.mjs`.
- New tests for orchestration edge cases (auto remapping + quality-gate overrides) and adapter env/payload behavior.

#### Changed

- CLI usage text now documents full adapter subcommand surface.
- `.collab` example config and adapter protocol docs now cover v0.2 adapter fields and team/quality settings.
- Parser/unit tests updated for v0.2 run flags and adapter command routing.
- Adapter payload transport now defaults to stdin with optional legacy env mode.
- Release workflow now validates tag/version alignment before packaging/publish.

### Added

- Stateful run pipeline with explicit execution modes: `plan`, `patch`, `apply`.
- Verification runner with profiles: `none`, `basic`, `strict`.
- Revision loops with failure feedback into subsequent attempts.
- Candidate patch synthesis from model-provided diff with fallback generation.
- Safe git apply utility with dry-run checks.
- Interactive mode via `collab chat`.
- Eval harness via `collab eval run --suite smoke|regression`.
- Event schema reference documentation for NDJSON traces.
- Replay summary stats and doctor remediation guidance.
- Release and nightly eval GitHub workflows.

### Changed

- CI now runs Node 20 and Node 22 matrix.
- Provider base requests now include retry/backoff and classified error taxonomy.
- Run pipeline verification executes against a temporary patched workspace.

### Fixed

- CI shell compatibility for verification commands by using POSIX `sh`.
