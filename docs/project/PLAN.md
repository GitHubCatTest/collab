# Collab Project Plan

## Goals

1. Build a terminal-native multi-model developer agent that coordinates heterogeneous frontier models.
2. Keep the core CLI open source (Apache-2.0) and useful without paid dependencies.
3. Produce transparent session artifacts: debate log, final report, patch diff, summary JSON.
4. Keep privacy and security strict: no secret leakage, no hidden telemetry, explicit consent for data sharing.

## v0.1 Scope (Locked)

- One-shot command UX: `collab run "<task>"`
- Round-based collaboration with arbiter scoring
- First-class API adapters: OpenRouter, Anthropic, Google, OpenAI
- Experimental subprocess subscription adapters
- Commands: `run`, `doctor`, `adapters list`, `replay`
- Output-only changes (no auto-apply to repository)

## v0.2 Milestone Plan (In Progress)

Status date: 2026-03-05

### M1: CLI and Config Surface

- [x] Add adapter CLI subcommands for v0.2 workflow expansion.
- [x] Support `run` flags: `--team`, `--debate-rounds`, `--require-evidence`.
- [x] Document CLI usage and config mapping for new run controls.

### M2: Runtime and Events

- [x] Apply `--team`/`--debate-rounds` controls inside orchestration paths.
- [x] Enforce evidence requirements when `--require-evidence` is enabled.
- [x] Emit v0.2 event types for role negotiation, disagreement, evidence checks, adapter health, and quality gates.

### M3: Test and Release Quality

- [x] Add parser-level test coverage for new run flags.
- [x] Add adapter CLI subcommand routing coverage.
- [x] Add command-level/e2e coverage for role negotiation and quality-gate overrides.
- [x] Prepare v0.2 release notes/changelog updates.

## Architecture Summary

- Runtime: TypeScript + Node
- Orchestrator: round engine with manual or auto role strategy (architect, implementer, reviewer, arbiter)
- Event bus: append-only structured events and NDJSON logs
- Artifacts: `final.md`, `patch.diff`, `session.ndjson`, `summary.json`
- Safety: redaction pipeline for known credential/token patterns

## Non-Goals for v0.1

- Automatic patch application to repository files
- Browser automation for account/subscription access
- Hosted cloud memory/workspaces/analytics
- Official Windows support (best-effort only)
