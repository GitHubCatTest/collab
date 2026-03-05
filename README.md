# collab-mcp

Multi-model collaborative planning MCP server for CLIs and IDEs.

`collab-mcp` runs a Mixture-of-Agents (MoA) planning pipeline across OpenAI, Anthropic, and Google models, then returns a structured plan with agreements, disagreements, tech-stack choices, implementation steps, and risks.

## Features

- MCP stdio server (`plan`, `compare`, `review` tools)
- Multi-model seed -> refine -> synthesize pipeline
- Graceful degradation (`Promise.allSettled`) with clear provider errors
- Cost-aware defaults (low-cost models, output-token caps, bounded layers)
- Structured output with parser fallback for imperfect model formatting

## Install

```bash
npm install
npm run build
```

Run locally:

```bash
npx tsx src/index.ts
```

## MCP Configuration

Example MCP server config:

```json
{
  "mcpServers": {
    "collab": {
      "command": "npx",
      "args": ["-y", "collab-mcp"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "GOOGLE_API_KEY": "AIza...",
        "COLLAB_DEFAULT_LAYERS": "2",
        "COLLAB_MAX_OUTPUT_TOKENS": "1200"
      }
    }
  }
}
```

At least two providers must be configured for collaborative planning.

## Tools

### `plan`

Input:

- `task` (string, required)
- `context` (string, optional)
- `layers` (1-4, optional)
- `focus` (`architecture|techstack|implementation|security|general`, optional)
- `providers` (`openai|anthropic|google`[], optional)
- `synthesizer` (`openai|anthropic|google`, optional)

Output:

- `plan.agreements[]`
- `plan.disagreements[]`
- `plan.tech_stack[]`
- `plan.implementation_steps[]`
- `plan.risks[]`
- `meta` (models used, layers run, token/cost estimate, duration, failures)

### `compare`

Compares options across models and returns:

- `recommendation`
- `rationale`
- `analysis` (structured plan sections)
- `meta`

### `review`

Reviews an existing plan and returns:

- `review` (structured critique sections)
- `meta`

## Cost Controls

Environment variables:

- `COLLAB_DEFAULT_LAYERS` (default `2`)
- `COLLAB_MAX_LAYERS` (default `4`)
- `COLLAB_MAX_OUTPUT_TOKENS` (default `1200`)
- `COLLAB_TIMEOUT_MS` (default `60000`)
- `COLLAB_DEFAULT_SYNTHESIZER` (`openai|anthropic|google`)

Model defaults are intentionally low-cost:

- OpenAI: `gpt-4o-mini`
- Anthropic: `claude-3-5-haiku-latest`
- Google: `gemini-2.0-flash`

## Subscription Transport (Adapter Protocol)

Direct provider API keys are the default path. You can switch any provider to local subscription transport using per-provider env vars:

- `COLLAB_OPENAI_TRANSPORT=subscription`
- `COLLAB_OPENAI_ADAPTER_COMMAND=/absolute/path/to/adapter`
- `COLLAB_OPENAI_ADAPTER_ARGS='[\"--flag\",\"value\"]'`
- `COLLAB_OPENAI_ADAPTER_TIMEOUT_MS=60000`

Same pattern applies to `OPENAI | ANTHROPIC | GOOGLE` provider prefixes.

When enabled, Collab invokes the adapter subprocess and writes this JSON payload to stdin:

```json
{
  "provider": "openai|anthropic|google",
  "model": "string",
  "messages": [{ "role": "system|user|assistant", "content": "string" }],
  "max_output_tokens": 1200
}
```

Adapter stdout may be either:

- Plain text response body
- JSON: `{ "content": "string", "tokens": { "input": 123, "output": 456 } }`

### Quick Subscription Setup (Gemini + Codex)

If you do not have API keys, you can run two providers in subscription mode (Google + OpenAI) using official CLIs:

- `scripts/adapters/gemini-cli-adapter.mjs`
- `scripts/adapters/codex-cli-adapter.mjs`

MCP server `env` example:

```json
{
  "COLLAB_GOOGLE_TRANSPORT": "subscription",
  "COLLAB_GOOGLE_ADAPTER_COMMAND": "node",
  "COLLAB_GOOGLE_ADAPTER_ARGS": "[\"/ABS/PATH/scripts/adapters/gemini-cli-adapter.mjs\"]",
  "COLLAB_OPENAI_TRANSPORT": "subscription",
  "COLLAB_OPENAI_ADAPTER_COMMAND": "node",
  "COLLAB_OPENAI_ADAPTER_ARGS": "[\"/ABS/PATH/scripts/adapters/codex-cli-adapter.mjs\"]",
  "COLLAB_DEFAULT_SYNTHESIZER": "google"
}
```

Notes:

- Keep API mode enabled for any provider where you set API keys; subscription mode is optional per provider.
- Antigravity/Cursor/etc. are MCP hosts; subscription adapter settings apply to this server process, not the host app.
- Use only official login flows from provider CLIs. Do not use token extraction/scraping proxies.

## MCP Smoke Test

Run a quick MCP wiring check:

```bash
npm run smoke:mcp
```

Use this before release cuts or after MCP tool/server changes.

## Development

```bash
npm run lint
npm test
npm run build
```

## Security

- Never commit API keys.
- Keep MCP env values local.
- See [SECURITY.md](SECURITY.md) for disclosure policy.
