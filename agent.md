# collab-mcp — Multi-Model Collaborative Planning MCP Server

## Product Summary

An MCP server that lets **any AI agent** — both CLIs (Claude Code, Codex CLI, OpenCode) and IDEs (Cursor, Antigravity, VS Code) — dispatch planning tasks to multiple LLMs simultaneously. Uses the **Mixture-of-Agents (MoA)** pattern. Works anywhere MCP works, via stdio transport.

> *"Get Claude, GPT, and Gemini to collaborate on your architecture before you write a single line of code."*

> *One-time setup. No new CLI to learn. Just better plans.*

### Scope Clarification (for this repo implementation)

- Build and ship a production-ready MCP server focused on planning (`plan`, `compare`, `review`)
- Keep runtime dependencies minimal (MCP SDK + Zod only)
- Start with API-key provider auth for reliability and fast setup
- Keep a clean extension point for **subscription adapters** without re-architecting core pipeline
- Prioritize cost control by default (bounded output tokens, low-cost defaults, max layers)

### Implementation Status (March 5, 2026)

- MVP implemented in this repository: MCP server + `plan` / `compare` / `review`
- MoA pipeline implemented with graceful degradation and structured parsing fallback
- Cost controls implemented (model defaults, token caps, bounded layers, single-provider synthesis with fallback fanout)
- Provider layer implemented for OpenAI, Anthropic, Google with retries/timeouts
- Unit/integration tests implemented for pipeline, parser, providers, MCP tool handlers, and MCP smoke flow
- Subscription transport protocol documented (adapter env contract + payload schema)
- MCP smoke-test workflow documented (`npm run smoke:mcp`)
- Remaining runtime expansion items are tracked under **Phase 3: Post-Launch**

---

## Why Planning Is the Focus

Planning is where multi-model collaboration provides the most value:

- **Architectural decisions are expensive to reverse** — spending 60 seconds on multi-model planning prevents hours of rework
- **Different models have different biases** — Claude favors certain patterns, GPT others, Gemini others. Getting all perspectives surfaces blind spots
- **MoA research proves this works** — collaborative LLMs scored 65.1% on AlpacaEval 2.0 vs single-model GPT-4 Omni's 57.5%
- **Cost is justified for planning** — $0.50–$3.00 for a battle-tested plan is a good trade
- **Coding conflicts are avoided** — multiple agents editing the same files causes merge hell. Planning doesn't touch files, so multi-model is safe and additive

---

## User Experience Flow

```
1. ONE-TIME SETUP: User adds collab-mcp to their MCP config

   # IDE config (Cursor, Antigravity, VS Code):
   {
     "mcpServers": {
       "collab": {
         "command": "npx",
         "args": ["-y", "collab-mcp"],
         "env": {
           "OPENAI_API_KEY": "sk-...",
           "ANTHROPIC_API_KEY": "sk-ant-...",
           "GOOGLE_API_KEY": "AIza..."
         }
       }
     }
   }

   # CLI config (Claude Code — ~/.claude/mcp.json):
   {
     "mcpServers": {
       "collab": {
         "command": "npx",
         "args": ["-y", "collab-mcp"],
         "env": { ... same API keys ... }
       }
     }
   }

   # Works identically in CLIs and IDEs — same stdio transport.

2. USAGE: User types naturally to their agent:
   "Plan out my project — a real-time chat app with auth, 
    payments, and notifications. Use collab to figure out
    the architecture and tech stack."

3. WHAT HAPPENS:
   → Agent calls collab-mcp's `plan` tool
   → collab-mcp sends the task to 3 models in parallel (HTTP API)
   → Models produce independent seed ideas (Layer 0)
   → Each model sees ALL seeds and refines collaboratively (Layer 1)
   → One model synthesizes the final plan
   → Result returns to the agent with merged, battle-tested plan

4. USER SEES: A comprehensive plan with:
   ✓ Architecture agreed upon by all models
   ✓ Tech stack with reasoning from each model
   ✓ Implementation steps (ordered)
   ✓ Risks and disagreements (so you know what to watch for)
   ✓ Cost/token metadata
```

---

## How Dispatching Works

collab-mcp is a **server process** that runs locally. It supports both direct provider HTTP (`fetch`) and optional subscription adapter subprocess transport without changing MCP tool APIs.

```
collab-mcp process
  │
  ├─ fetch("https://api.openai.com/v1/chat/completions", {
  │     headers: { Authorization: "Bearer sk-..." },
  │     body: { model: "gpt-5.3x-high", messages: [...] }
  │  })
  │
  ├─ fetch("https://api.anthropic.com/v1/messages", {
  │     headers: { "x-api-key": "sk-ant-..." },
  │     body: { model: "claude-opus-4-6", messages: [...] }
  │  })
  │
  └─ fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:generateContent", {
       headers: { "x-goog-api-key": "AIza..." },
       body: { contents: [...] }
     })

All 3 calls happen in parallel via Promise.allSettled()
```

**Authentication**: API keys are passed via environment variables in MCP config for API mode. Subscription-backed adapters can be enabled per provider via transport env vars.

---

## MoA Pipeline — The Core Engine

This is the heart of the product. Each "layer" is a round of parallel API calls.

**Efficiency**: 7 total API calls at default layers (3 seeds + 3 refines + 1 synthesis). ~15-45 seconds wall time depending provider latency. Cost is managed via low-cost default models, max output-token caps, and layer limits.

### Layer 0: Seed (Perspective-Steered, Independent)

Each model gets the task with a **different evaluation lens** to maximize diversity:

```
# Model A (e.g. Claude) — steered toward scalability
SYSTEM: You are an expert focused on SCALABILITY and PERFORMANCE.
        Give your initial take on this planning task.
        Emphasize: system design, data flow, load handling, caching.
        Be concise (500 words max). Other models will see your response.

# Model B (e.g. GPT) — steered toward simplicity
SYSTEM: You are an expert focused on DEVELOPER EXPERIENCE and SIMPLICITY.
        Give your initial take on this planning task.
        Emphasize: maintainability, onboarding ease, fewer dependencies.
        Be concise (500 words max). Other models will see your response.

# Model C (e.g. Gemini) — steered toward reliability
SYSTEM: You are an expert focused on SECURITY and RELIABILITY.
        Give your initial take on this planning task.
        Emphasize: auth, data protection, error handling, observability.
        Be concise (500 words max). Other models will see your response.

USER (all models): [the user's planning task + context]
```

**Why perspective-steering?** Without it, all 3 models tend to produce similar plans. By giving each a different lens, seeds naturally cover more ground — like a review panel where each reviewer has a specialty.

**Why independent first?** Prevents anchoring bias. Research confirms LLMs still anchor on the first output they see, even advanced reasoning models.

### Layer 1: Refine (Collaborative — The MoA Advantage)

Each model receives ALL Layer 0 seeds + the original task. This is the **shared context window** where models genuinely collaborate.

```
SYSTEM: You are collaborating with other expert models.
        Below are the initial perspectives from all models.
        Your job:
        1. NAME what you're adopting from others and why
        2. NAME what you're rejecting and why
        3. IDENTIFY gaps no model addressed yet
        4. Produce a refined, comprehensive plan

USER:   Original task: [task]
        
        --- Model A's take (Scalability Focus) ---
        [seed from model A]
        
        --- Model B's take (Simplicity Focus) ---
        [seed from model B]
        
        --- Model C's take (Security Focus) ---
        [seed from model C]
        
        Now produce your refined, comprehensive plan.
```

Every model sees what every other model said. They build on the best ideas, reject weak ones, and fill gaps.

### Layer 2+ (Optional)

Same pattern — each model sees all Layer 1 refined plans. Diminishing returns after 2 layers typically. Configurable via the `layers` parameter (default: 2).

### Final: Synthesis (Structured Output)

One model (configurable, defaults to Claude) produces **parseable structured output**:

```
SYSTEM: You are the final synthesizer. You've seen multiple rounds 
        of expert collaboration. Produce a structured plan with
        EXACTLY these sections, using markdown headers:

        ## Agreements
        Points all models converged on.

        ## Disagreements
        Where models diverged. For each: the topic, each position, 
        and which approach you recommend with reasoning.

        ## Tech Stack
        For each layer (frontend, backend, database, infra, etc.):
        the recommended choice, WHY (referencing which models favored it),
        and alternatives considered.

        ## Implementation Steps  
        Ordered, numbered steps with brief descriptions and effort estimates.

        ## Risks
        Issues identified by any model. Include severity and which model found it.

USER:   Original task: [task]
        [all Layer 1/2 outputs]
```

Structured headers ensure the output is parseable and consistent regardless of which model synthesizes.

---

## MCP Tools Exposed

### `plan` — Core collaborative planning

```typescript
// Input schema (validated with Zod)
{
  task: string,              // What to plan (required)
  context?: string,          // Existing code, constraints, README, etc.
  layers?: number,           // MoA refinement layers (default: 2, max: 4)
  focus?: "architecture" | "techstack" | "implementation" | "security" | "general",
  models?: string[],         // Override models (default: all configured)
  synthesizer?: string       // Which model does final synthesis
}

// Output
{
  plan: {
    agreements: string[],
    disagreements: {
      topic: string,
      positions: { model: string, position: string }[]
    }[],
    tech_stack: {
      category: string,            // e.g. "Backend Framework"
      choice: string,              // e.g. "Express.js"
      reasoning: string,
      alternatives: string[]
    }[],
    implementation_steps: {
      order: number,
      title: string,
      description: string,
      estimated_effort: string
    }[],
    risks: {
      risk: string,
      severity: "low" | "medium" | "high",
      identified_by: string
    }[]
  },
  meta: {
    models_used: string[],
    layers_run: number,
    total_tokens: number,
    estimated_cost_usd: number,
    duration_ms: number
  }
}
```

### `compare` — Multi-model decision helper

For specific choices: "Should I use PostgreSQL or MongoDB for this?"

### `review` — Multi-model plan review

Feed in an existing plan, get critiques from all models.

---

## File Structure

```
collab ai/
├── src/
│   ├── index.ts                 # MCP server entry point (stdio)
│   ├── server.ts                # MCP server setup + tool registration
│   ├── config.ts                # Env config and defaults
│   ├── pipeline/
│   │   ├── moa.ts               # MoA pipeline engine (seed → refine → synthesize)
│   │   ├── prompts.ts           # All prompt templates for each stage
│   │   ├── parser.ts            # Structured markdown-to-JSON extraction
│   │   └── types.ts             # Pipeline types (SeedResult, RefinedPlan, etc.)
│   ├── providers/
│   │   ├── base.ts              # Shared HTTP helpers + retries/timeouts
│   │   ├── openai.ts            # OpenAI API wrapper (HTTP fetch)
│   │   ├── anthropic.ts         # Anthropic API wrapper (HTTP fetch)
│   │   ├── google.ts            # Google AI API wrapper (HTTP fetch)
│   │   ├── factory.ts           # Creates providers from config/env
│   │   └── types.ts             # Provider types (Message, Response, etc.)
│   └── tools/
│       ├── plan.ts              # `plan` tool handler
│       ├── compare.ts           # `compare` tool handler
│       └── review.ts            # `review` tool handler
├── tests/
│   ├── pipeline.moa.test.ts     # MoA pipeline unit tests (mocked providers)
│   ├── pipeline.parser.test.ts  # Structured output parser tests
│   ├── providers.base.test.ts   # Retry/timeout/error behavior
│   └── tools.plan.test.ts       # Plan tool integration-level tests
├── package.json
├── tsconfig.json
├── agent.md                     # This file
└── README.md
```

---

## Key Technical Decisions

### 1. MCP Server Setup

```typescript
// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "collab",
  version: "1.0.0"
});

server.tool("plan", {
  task: z.string().describe("What to plan"),
  context: z.string().optional().describe("Project context, constraints"),
  layers: z.number().min(1).max(4).default(2).describe("MoA refinement layers"),
  focus: z.enum(["architecture", "techstack", "implementation", "security", "general"]).default("general"),
}, async (args) => {
  // 1. Load providers from env config
  // 2. Run MoA pipeline (seed → refine → synthesize)
  // 3. Return structured result
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

### 2. Provider Interface

```typescript
// src/providers/base.ts
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionResult {
  content: string;
  model: string;
  tokens: { input: number; output: number };
}

export interface Provider {
  name: string;           // "openai" | "anthropic" | "google"
  model: string;          // "gpt-5.3x-high" | "claude-opus-4-6" | etc.
  complete(messages: Message[]): Promise<CompletionResult>;
}
```

Each provider wraps a single `fetch()` call. No SDKs — just HTTP. Keeps dependencies to 2 (MCP SDK + Zod).

### 3. MoA Pipeline

```typescript
// src/pipeline/moa.ts — core logic
export async function runMoaPipeline(
  task: string,
  providers: Provider[],
  options: { layers: number; focus: string },
  notify: (msg: string) => void
): Promise<PipelineResult> {
  
  notify("🌱 Seed round: generating initial perspectives...");
  
  // Layer 0: Seed — each model gets a perspective-steered prompt
  const seedPrompts = buildSeedPrompts(task, providers, options.focus);
  const seeds = await Promise.allSettled(
    providers.map((p, i) => p.complete(seedPrompts[i]))
  );
  const seedResults = extractSuccessful(seeds, providers);
  
  if (seedResults.length < 2) {
    throw new Error("Need at least 2 models for collaboration. Check API keys.");
  }

  notify("🔄 Refine round: models collaborating on shared context...");

  // Layer 1+: Refine — each model sees all previous outputs
  let currentOutputs = seedResults;
  for (let layer = 1; layer <= options.layers; layer++) {
    const refined = await Promise.allSettled(
      providers.map(p => p.complete(
        buildRefinePrompt(task, currentOutputs, options.focus)
      ))
    );
    currentOutputs = extractSuccessful(refined, providers);
  }

  notify("📋 Synthesizing final plan...");

  // Final: Synthesize — one model merges everything
  const synthesizer = providers[0]; // configurable
  const synthesis = await synthesizer.complete(
    buildSynthesisPrompt(task, currentOutputs)
  );
  
  return {
    seeds: seedResults,
    refined: currentOutputs,
    synthesis: synthesis.content,
    meta: computeMeta(seedResults, currentOutputs, synthesis)
  };
}
```

### 4. Error Handling / Graceful Degradation

```typescript
// Each fetch call uses AbortController with per-provider timeout
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    
    // 429 (rate limit) → retry once with backoff
    if (response.status === 429) {
      await sleep(2000);
      return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    }
    
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// Promise.allSettled() collects all results including failures
const results = await Promise.allSettled(calls);
const successful = results.filter(r => r.status === "fulfilled");

// Minimum 2 providers must succeed per layer
if (successful.length < 2) {
  throw new Error("Need at least 2 models to collaborate. Check API keys.");
}
// If only 2 of 3 succeed, pipeline continues — still better than 1 model
```

### 5. Progress Notifications

For planning sessions (15-45 seconds), users need feedback. MCP supports logging:

```typescript
// Pass server reference to pipeline for progress updates
server.sendLoggingMessage({ level: "info", data: "🌱 Seed round: 3 models generating initial perspectives..." });
server.sendLoggingMessage({ level: "info", data: "🔄 Refine round: models collaborating on shared context..." });
server.sendLoggingMessage({ level: "info", data: "📋 Synthesizing final plan..." });
```

### 6. Configuration

All via environment variables (set in MCP config):

| Variable | Required | Default |
|---|---|---|
| `OPENAI_API_KEY` | At least 2 of 3 | — |
| `ANTHROPIC_API_KEY` | At least 2 of 3 | — |
| `GOOGLE_API_KEY` | At least 2 of 3 | — |
| `COLLAB_DEFAULT_LAYERS` | No | `2` |
| `COLLAB_DEFAULT_SYNTHESIZER` | No | `"anthropic"` |
| `COLLAB_TIMEOUT_MS` | No | `60000` |
| `COLLAB_OPENAI_MODEL` | No | `"gpt-4o-mini"` |
| `COLLAB_ANTHROPIC_MODEL` | No | `"claude-3-5-haiku-latest"` |
| `COLLAB_GOOGLE_MODEL` | No | `"gemini-2.0-flash"` |
| `COLLAB_MAX_OUTPUT_TOKENS` | No | `1200` |
| `COLLAB_ENABLE_COST_GUARDRAILS` | No | `"true"` |

### 7. Cost Guardrails (Required for OSS UX)

- Default to lower-cost, planning-capable models and let users opt up
- Hard-cap per-call output tokens
- Cap `layers` at 4, with default 2
- Include estimated spend in tool output metadata
- Fail fast with actionable errors if user asks for unavailable/invalid models

---

## What Gets Reused vs Built Fresh

| Component | Action |
|---|---|
| `src/providers/openai.ts` | **Adapt** — has the HTTP call structure, update for new interface |
| `src/providers/anthropic.ts` | **Adapt** — same |
| `src/providers/google.ts` | **Adapt** — same |
| `src/providers/base.ts` | **Adapt** — keep timeout/retry hardening, simplify prompt-specific logic out of providers |
| `src/providers/types.ts` | **Adapt** — simplify to new Provider interface |
| `src/orchestrator/` | **Replace** — new `src/pipeline/` MoA engine |
| `src/arbiter/` | **Remove** — superseded by synthesis stage in MoA |
| `src/adapters/` | **Keep + extend** — includes subscription adapter subprocess transport |
| `src/commands/` | **Remove** — CLI entrypoints replaced by MCP tool registration |
| `src/safety/` | **Keep minimal redaction utility** — sanitize logs/errors returned to clients |
| `src/verification/` | **Drop for MVP** — reintroduce only if MCP-side validation hooks are added |
| `src/index.ts` | **Replace** — new MCP server entry point |

---

## Dependencies

```json
{
  "name": "collab-mcp",
  "version": "1.0.0",
  "type": "module",
  "bin": { "collab-mcp": "./dist/index.js" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "tsx": "^4.19.2",
    "typescript": "^5.8.2"
  }
}
```

**Two production dependencies.** HTTP calls use native `fetch()` (Node 20+). No provider SDKs needed.

---

## Development Phases

### Phase 1: MVP (3-4 days)

- [x] Clean workspace — remove CLI command surface, keep reusable provider utilities
- [x] Install MCP SDK + Zod
- [x] Build MCP server entry point (`index.ts`, `server.ts`)
- [x] Build provider layer (OpenAI, Anthropic, Google — HTTP fetch + AbortController + retry)
- [x] Build MoA pipeline (`moa.ts`, `prompts.ts` with perspective-steering)
- [x] Build `plan` tool handler with structured parser fallback
- [x] Config from env vars
- [x] Cost guardrails (cheap defaults, output token caps, layer bounds)
- [x] Progress notifications via MCP logging
- [ ] Test in Antigravity IDE AND Claude Code CLI
- [x] Basic README with config examples for IDEs and CLIs

### Phase 2: Polish (2-3 days)

- [x] `compare` and `review` tools (share same provider/pipeline core)
- [x] Cost tracking per call
- [x] Better error messages and validation
- [x] Document subscription transport env variables and adapter payload protocol
- [x] Add MCP smoke test usage docs (`npm run smoke:mcp`)
- [ ] npm publish as `collab-mcp`
- [ ] GitHub README with demo GIF

### Phase 3: Post-Launch

- [x] Define/document subscription transport protocol (env vars + payload shape)
- [x] Wire subscription adapter mode into MCP runtime (use local user subscriptions via adapter protocol, no scraping/token extraction)
- [ ] Model presets ("fast" = lighter models, "thorough" = reasoning models)
- [ ] Persistent planning sessions (continue a previous plan)

### Remaining Post-Launch Items (Open)

- [ ] Test in Antigravity IDE and Claude Code CLI against installed MCP server
- [ ] npm publish as `collab-mcp`
- [ ] GitHub README with demo GIF
- [ ] Model presets ("fast" / "thorough")
- [ ] Persistent planning sessions

---

## Verification

### Automated

```bash
npm test                                          # Unit tests (mocked providers)
npx @modelcontextprotocol/inspector collab-mcp    # MCP protocol validator
npm run smoke:mcp                                 # MCP smoke test
```

### End-to-End

1. **Antigravity IDE**: Add collab-mcp to MCP config, trigger planning task, verify multi-model response
2. **Claude Code CLI**: Add to `~/.claude/mcp.json`, run planning task, verify same behavior
3. **Full pipeline**: Plan a real feature (e.g., "design a rate limiter for an Express API"), verify:
   - All configured models contribute
   - Synthesis has agreements + disagreements + tech stack
   - Graceful degradation when one API key is missing
4. **Cost check**: Verify estimated cost in `meta` matches actual API billing

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────┐
│  User's AI Agent (Antigravity / Claude Code /    │
│  Codex CLI / Cursor / OpenCode / any MCP host)   │
│                                                  │
│  User: "Plan my app's architecture using collab" │
│           ↕ MCP Protocol (stdio)                 │
├──────────────────────────────────────────────────┤
│                  collab-mcp                      │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │  Tool: plan / compare / review              │ │
│  └──────────────┬──────────────────────────────┘ │
│                 │                                │
│  ┌──────────────▼──────────────────────────────┐ │
│  │  MoA Pipeline Engine                        │ │
│  │                                             │ │
│  │  Layer 0: seed()    ─ perspective-steered   │ │
│  │                       independent takes     │ │
│  │  Layer 1: refine()  ─ shared context,       │ │
│  │                       models see each other │ │
│  │  Final:   synth()   ─ structured output     │ │
│  └──────────────┬──────────────────────────────┘ │
│                 │                                │
│  ┌──────────────▼──────────────────────────────┐ │
│  │  Provider Layer (HTTP fetch, parallel)      │ │
│  │  ┌────────┐  ┌──────────┐  ┌────────────┐  │ │
│  │  │ OpenAI │  │Anthropic │  │ Google AI  │  │ │
│  │  │  API   │  │   API    │  │    API     │  │ │
│  │  └────────┘  └──────────┘  └────────────┘  │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```
