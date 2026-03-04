# collab

Terminal-native heterogeneous multi-model development agent CLI.

## Commands

- `collab run "<task>"`
- `collab chat`
- `collab eval run --suite smoke|regression [--json]`
- `collab doctor`
- `collab adapters list`
- `collab replay <session.ndjson>`

## Quick start

1. Install dependencies: `npm install`
2. Run in dev mode: `npm run dev -- run "summarize this repo"`
3. Build: `npm run build`
4. Diagnose setup: `npm run dev -- doctor`
5. Interactive follow-up mode:
   - `npm run dev -- chat --mode plan`
6. Production-style run example:
   - `npm run dev -- run "refactor auth module" --mode patch --verify strict --max-revisions 2`
7. Apply mode (with explicit confirmation by default):
   - `npm run dev -- run "implement rate limiter" --mode apply --verify basic`
8. Eval harness:
   - `npm run eval:smoke`
   - `npm run eval:regression`

## Configuration

Config precedence:

1. CLI flags
2. `.collab.json` (project root)
3. `~/.config/collab/config.json`

Telemetry is disabled by default and must be explicitly enabled.

Key run flags:

- `--mode plan|patch|apply`
- `--verify none|basic|strict`
- `--max-revisions <n>`
- `--yes` (skip apply confirmation prompt)

Example config: [`docs/reference/.collab.example.json`](docs/reference/.collab.example.json)
Adapter protocol: [`docs/reference/ADAPTER_PROTOCOL.md`](docs/reference/ADAPTER_PROTOCOL.md)
Event schema: [`docs/reference/EVENT_SCHEMA.md`](docs/reference/EVENT_SCHEMA.md)

## Security and Privacy

- Logs and artifacts are redacted for common credential/token patterns.
- Telemetry is opt-in only.
- No browser scraping or token extraction from web subscriptions is supported.
- See [`docs/SECURITY_AND_PRIVACY.md`](docs/SECURITY_AND_PRIVACY.md) and [`docs/AUTH_AND_PROVIDER_POLICIES.md`](docs/AUTH_AND_PROVIDER_POLICIES.md).

## Project Tracking

- Plan: [`docs/project/PLAN.md`](docs/project/PLAN.md)
- Status: [`docs/project/STATUS.md`](docs/project/STATUS.md)
- Roadmap: [`ROADMAP.md`](ROADMAP.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)

## Release and Eval Automation

- CI runs on Node 20 and Node 22.
- Nightly smoke eval runs via GitHub Actions (`nightly-eval.yml`).
- Tagging `v*` triggers release workflow that validates, packs npm artifact, creates GitHub release, and optionally publishes to npm when `NPM_TOKEN` is configured.
