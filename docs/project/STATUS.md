# Collab Project Status

## Completed

- Initial TypeScript CLI scaffold and build scripts
- Core configuration system with defaults and precedence
- Provider adapter implementations (OpenRouter, Anthropic, Google, OpenAI)
- Experimental subprocess adapter framework
- Round-based orchestration engine with deterministic arbiter scoring
- Artifact writer for final report, patch, event log, and summary output
- CLI commands: `run`, `doctor`, `adapters list`, `replay`
- Security redaction utilities for sensitive values in logs/output
- GitHub project foundation: CI, CodeQL, secret scanning, issue/PR templates
- OSS docs foundation: contributing, security policy, code of conduct, license
- Provider policy documentation and subscription-safe boundaries
- Adapter protocol documentation and runnable example adapter script
- CLI/config hardening for production flags (`--mode`, `--verify`, `--max-revisions`, `--yes`)
- Parser validation and tests for new run-flag behaviors
- Stateful run pipeline with revision loops and explicit apply confirmation gating
- Verification runner (`none|basic|strict`) with command-level result capture
- Patch synthesis pipeline with model-provided unified diff extraction + fallback patch generation
- Safe git apply utility with dry-run check support
- Provider error taxonomy + retry/backoff handling for transient failures
- Interactive follow-up mode via `collab chat`
- Replay command now includes session-level summary stats (type/role counts, warnings, estimated cost)
- Doctor command now includes actionable remediation guidance for missing provider keys and adapters
- Event schema reference documentation added for NDJSON traces
- Eval harness command added (`collab eval run --suite smoke|regression`) with CI/nightly automation
- Release workflow automation added (tag-driven packaging + GitHub release + optional npm publish)
- CI upgraded to Node 20 and Node 22 matrix
- End-to-end run command tests for plan/patch modes with local adapter fixtures
- Roadmap and changelog docs added for release discipline

## In Progress

- Additional end-to-end orchestration tests
- Release versioning discipline and launch benchmark content

## Next

1. Add comprehensive unit/integration/e2e tests from the v0.1 matrix.
2. Improve failure categorization for degraded provider sessions.
3. Add benchmark fixtures and publish comparative eval reports in repo.
4. Prepare OSS launch docs (roadmap, demos, contribution-first onboarding).
