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

## Architecture Summary

- Runtime: TypeScript + Node
- Orchestrator: round engine with fixed roles (architect, implementer, reviewer, arbiter)
- Event bus: append-only structured events and NDJSON logs
- Artifacts: `final.md`, `patch.diff`, `session.ndjson`, `summary.json`
- Safety: redaction pipeline for known credential/token patterns

## Non-Goals for v0.1

- Automatic patch application to repository files
- Browser automation for account/subscription access
- Hosted cloud memory/workspaces/analytics
- Official Windows support (best-effort only)
