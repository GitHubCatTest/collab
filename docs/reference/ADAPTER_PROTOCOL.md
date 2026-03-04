# Subprocess Adapter Protocol (v0.1)

`collab` supports experimental subscription-safe adapter integration through local subprocess commands.

## Contract

- Collab executes your adapter command from config.
- Collab passes JSON payload in `COLLAB_ADAPTER_PAYLOAD` env var.
- Adapter must print plain text to stdout with sections:
  - `SUMMARY:`
  - `DIFF_PLAN:`
  - `RISKS:`
  - `TESTS:`
  - `EVIDENCE:`

## Input payload shape

```json
{
  "model": "string",
  "role": "architect|implementer|reviewer",
  "round": 1,
  "task": "string",
  "boardSummary": "string"
}
```

## Example configuration

```json
{
  "subscriptionAdapters": [
    {
      "name": "example-local",
      "command": "node",
      "args": ["scripts/adapters/example-adapter.mjs"],
      "enabled": true
    }
  ],
  "roles": {
    "architect": {
      "provider": "adapter",
      "adapter": "example-local",
      "model": "local-example"
    },
    "implementer": {
      "provider": "openai",
      "model": "gpt-5-codex"
    },
    "reviewer": {
      "provider": "anthropic",
      "model": "claude-opus-4.6"
    },
    "arbiter": {
      "provider": "anthropic",
      "model": "claude-opus-4.6"
    }
  }
}
```

## Security constraints

- No cookie/token extraction from browser sessions.
- No hidden credential forwarding.
- Keep adapter auth under user-controlled local CLI login flows.
