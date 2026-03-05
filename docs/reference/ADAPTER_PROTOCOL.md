# Subprocess Adapter Protocol (v0.2)

`collab` supports local subprocess adapters for subscription-safe integrations.

## Adapter config fields

```json
{
  "name": "example-local",
  "command": "node",
  "args": ["scripts/adapters/example-adapter.mjs"],
  "outputFormat": "sections",
  "payloadMode": "stdin",
  "inheritEnv": false,
  "passEnv": ["PATH", "HOME"],
  "testArgs": ["scripts/adapters/example-adapter.mjs"],
  "healthCheckArgs": ["scripts/adapters/health-check.mjs"],
  "env": {
    "EXAMPLE_PROFILE": "local"
  },
  "enabled": true
}
```

- `outputFormat`: `"sections"` (default) or `"json"`.
- `payloadMode`: `"stdin"` (default, recommended) or `"env"` (legacy compatibility).
- `inheritEnv`: optional bool. If `false`/unset, Collab passes a strict env allowlist plus `passEnv`.
- `passEnv`: optional env keys to explicitly forward (for example `["OPENAI_API_KEY"]`).
- `testArgs`: optional args used by `collab adapters test <name>`.
- `healthCheckArgs`: optional args used by `collab adapters doctor`.
- `env`: optional env vars merged into adapter process env.
- `args`: used for normal orchestration generation calls.

Existing v0.1 adapter configs remain valid. If `outputFormat` is omitted, behavior is unchanged (`"sections"`).

## Execution contract

- Collab executes your adapter `command` with `args` (or `testArgs` / `healthCheckArgs` for those CLI flows).
- Collab passes JSON payload over stdin by default (`payloadMode: "stdin"`).
- When explicitly configured with `payloadMode: "env"`, payload is provided via `COLLAB_ADAPTER_PAYLOAD`.
- Optional health probes also set `COLLAB_ADAPTER_HEALTHCHECK=1`.

### Input payload shape

```json
{
  "model": "string",
  "role": "architect|implementer|reviewer",
  "round": 1,
  "task": "string",
  "boardSummary": "string",
  "priorMessages": [
    {
      "id": "string",
      "ts": "ISO-8601",
      "sessionId": "string",
      "round": 1,
      "role": "architect|implementer|reviewer|arbiter",
      "type": "role_response|proposal|arbiter_decision|system|warning|state_transition|verification|role_negotiation|disagreement_flag|evidence_check|adapter_health|quality_gate",
      "content": "string",
      "refs": ["string"]
    }
  ]
}
```

`priorMessages` is bounded and truncated by Collab runtime for safety/size.

### Environment contract

- `COLLAB_ADAPTER_PAYLOAD_MODE`: `stdin` or `env`.
- `COLLAB_ADAPTER_PAYLOAD`: present only when `payloadMode: "env"`.
- `COLLAB_ADAPTER_HEALTHCHECK=1`: present for health-check subprocess calls.

## Output formats

### 1) `outputFormat: "sections"` (v0.1 compatible)

Adapter writes plain text sections to stdout:

- `SUMMARY:`
- `DIFF_PLAN:`
- `RISKS:`
- `TESTS:`
- `EVIDENCE:`

### 2) `outputFormat: "json"` (v0.2)

Adapter writes JSON to stdout:

```json
{
  "summary": "string",
  "diffPlan": "string",
  "risks": ["string"],
  "tests": ["string"],
  "evidence": ["string"]
}
```

Also accepted:
- `diff_plan` / `DIFF_PLAN`
- uppercase section keys
- nested object under `sections`

Collab normalizes JSON output back into section text before downstream parsing, so existing proposal parsing logic remains unchanged.

## Adapter error taxonomy

Adapter failures are surfaced with stable tags:

- `[adapter/not-found]`
- `[adapter/timeout]`
- `[adapter/parse-failed]`
- `[adapter/non-zero-exit]`

## Adapter CLI flows

- `collab adapters list`
- `collab adapters test <name>`
- `collab adapters doctor`
- `collab adapters init --preset tri-subscription`

`init` writes `.collab.adapters.tri-subscription.json` when safe. If write is risky (existing file/permissions), it prints the snippet to stdout.
The preset maps roles to a tri-model layout (`gemini` architect, `codex` implementer, `claude` reviewer/arbiter) using local adapter templates. Replace the generated `command`/`args` with your actual local CLI passthrough commands.

## Security constraints

- No cookie/token extraction from browser sessions.
- No hidden credential forwarding.
- Keep adapter auth under user-controlled local CLI login flows.
- Default adapter execution environment is allowlisted. Use `inheritEnv`/`passEnv` deliberately.
