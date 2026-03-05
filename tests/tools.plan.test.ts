import assert from "node:assert/strict";
import test from "node:test";
import type { CollabMcpConfig } from "../src/config.js";
import { runPlanTool } from "../src/tools/plan.js";

const SYNTHESIS_MARKDOWN = [
  "## Agreements",
  "- Use staged rollout with feature flags",
  "- Keep schema migrations backward compatible",
  "",
  "## Disagreements",
  "- Queue backend: Redis vs SQS; recommend SQS for managed ops",
  "",
  "## Tech Stack",
  "- API: Fastify - lean HTTP layer and strong plugin ecosystem",
  "- Database: PostgreSQL vs MySQL - choose PostgreSQL",
  "",
  "## Implementation Steps",
  "1. Define service boundaries: API, worker, notifier",
  "2. Implement queue abstraction and worker consumer",
  "3. Add smoke tests and rollout runbook",
  "",
  "## Risks",
  "- Token leakage in logs during incident debugging"
].join("\n");

test("runPlanTool returns structured plan output and bounded call volume", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
  };

  let callCount = 0;

  process.env.OPENAI_API_KEY = "test-openai";
  process.env.ANTHROPIC_API_KEY = "test-anthropic";

  globalThis.fetch = (async (url: string | URL) => {
    callCount += 1;
    const target = String(url);

    if (target.includes("openai.com")) {
      return new Response(JSON.stringify({ output_text: SYNTHESIS_MARKDOWN }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (target.includes("anthropic.com")) {
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: SYNTHESIS_MARKDOWN }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }

    throw new Error(`Unexpected URL in test fetch mock: ${target}`);
  }) as typeof fetch;

  try {
    const config: CollabMcpConfig = {
      defaultLayers: 1,
      maxLayers: 4,
      timeoutMs: 1000,
      maxOutputTokens: 800,
      defaultSynthesizer: "anthropic",
      providers: {
        openai: {
          provider: "openai",
          model: "gpt-4o-mini",
          apiKeyEnv: "OPENAI_API_KEY",
          baseUrl: "https://api.openai.com/v1/responses",
          timeoutMs: 1000,
          maxOutputTokens: 800,
          available: true
        },
        anthropic: {
          provider: "anthropic",
          model: "claude-3-5-haiku-latest",
          apiKeyEnv: "ANTHROPIC_API_KEY",
          baseUrl: "https://api.anthropic.com/v1/messages",
          timeoutMs: 1000,
          maxOutputTokens: 800,
          available: true
        },
        google: {
          provider: "google",
          model: "gemini-2.0-flash",
          apiKeyEnv: "GOOGLE_API_KEY",
          baseUrl:
            "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
          timeoutMs: 1000,
          maxOutputTokens: 800,
          available: false
        }
      }
    };

    const result = await runPlanTool(
      {
        task: "Plan architecture for a queue-backed notification service",
        layers: 1,
        focus: "architecture"
      },
      { config }
    );

    assert.ok(result.plan.agreements.length >= 2);
    assert.equal(result.plan.disagreements[0]?.topic, "Queue backend");
    assert.equal(result.plan.tech_stack[0]?.category, "API");
    assert.equal(result.plan.implementation_steps[0]?.order, 1);
    assert.equal(result.plan.risks[0]?.severity, "high");

    assert.equal(result.meta.layers_run, 1);
    assert.ok(result.meta.total_tokens > 0);
    assert.equal(result.meta.fallback_parser_used, false);

    // 2 providers, 1 layer => seed(2) + refine(2) + synth(1) = 5 calls.
    assert.equal(callCount, 5);
  } finally {
    globalThis.fetch = originalFetch;

    if (originalEnv.OPENAI_API_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    }

    if (originalEnv.ANTHROPIC_API_KEY === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    }
  }
});
