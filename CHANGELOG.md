# Changelog

## Unreleased

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
