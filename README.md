# collab

Terminal-native heterogeneous multi-model development agent CLI.

## Commands

- `collab run "<task>"`
- `collab doctor`
- `collab adapters list`
- `collab replay <session.ndjson>`

## Quick start

1. Install dependencies: `npm install`
2. Run in dev mode: `npm run dev -- run "summarize this repo"`
3. Build: `npm run build`
4. Diagnose setup: `npm run dev -- doctor`

## Configuration

Config precedence:

1. CLI flags
2. `.collab.json` (project root)
3. `~/.config/collab/config.json`

Telemetry is disabled by default and must be explicitly enabled.

Example config: [`docs/reference/.collab.example.json`](docs/reference/.collab.example.json)

## Security and Privacy

- Logs and artifacts are redacted for common credential/token patterns.
- Telemetry is opt-in only.
- No browser scraping or token extraction from web subscriptions is supported.
- See [`docs/SECURITY_AND_PRIVACY.md`](docs/SECURITY_AND_PRIVACY.md) and [`docs/AUTH_AND_PROVIDER_POLICIES.md`](docs/AUTH_AND_PROVIDER_POLICIES.md).

## Project Tracking

- Plan: [`docs/project/PLAN.md`](docs/project/PLAN.md)
- Status: [`docs/project/STATUS.md`](docs/project/STATUS.md)
