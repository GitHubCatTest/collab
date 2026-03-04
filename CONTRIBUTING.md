# Contributing

## Setup

1. Install Node.js 22+
2. Install dependencies: `npm install`
3. Run tests: `npm test`

## Development flow

1. Create a branch.
2. Make focused changes with tests.
3. Run `npm run lint && npm test && npm run build`.
4. Open a pull request using the provided template.

## Security requirements

- Never commit secrets or local credentials.
- Keep telemetry opt-in only.
- Do not add browser automation to access paid subscriptions/accounts.
