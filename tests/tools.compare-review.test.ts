import assert from "node:assert/strict";
import test from "node:test";
import type { CollabMcpConfig } from "../src/config.js";
import { runCompareTool } from "../src/tools/compare.js";
import { runReviewTool } from "../src/tools/review.js";

const COMPARE_SYNTHESIS = [
  "## Agreements",
  "- Recommendation: PostgreSQL",
  "- Rationale: Better relational guarantees and migration tooling for this use case.",
  "",
  "## Disagreements",
  "- PostgreSQL vs MongoDB trade-off remains around schema flexibility.",
  "",
  "## Tech Stack",
  "- Database: PostgreSQL",
  "",
  "## Implementation Steps",
  "1. Define relational schema",
  "2. Add migration pipeline",
  "",
  "## Risks",
  "- Migration drift if schema changes are unmanaged"
].join("\n");

const REVIEW_SYNTHESIS = [
  "## Agreements",
  "- Add explicit rollback checkpoints",
  "",
  "## Disagreements",
  "- Deployment strategy: blue/green vs canary",
  "",
  "## Tech Stack",
  "- Observability: OpenTelemetry",
  "",
  "## Implementation Steps",
  "1. Add pre-deploy health gates",
  "2. Add post-deploy smoke checks",
  "",
  "## Risks",
  "- Silent failures without alert routing"
].join("\n");

test("compare and review tools return structured outputs", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
  };

  process.env.OPENAI_API_KEY = "test-openai";
  process.env.ANTHROPIC_API_KEY = "test-anthropic";

  let compareCalls = 0;
  let reviewCalls = 0;

  const mode = { current: "compare" as "compare" | "review" };

  globalThis.fetch = (async (url: string | URL) => {
    const target = String(url);
    const markdown = mode.current === "compare" ? COMPARE_SYNTHESIS : REVIEW_SYNTHESIS;

    if (mode.current === "compare") {
      compareCalls += 1;
    } else {
      reviewCalls += 1;
    }

    if (target.includes("openai.com")) {
      return new Response(JSON.stringify({ output_text: markdown }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (target.includes("anthropic.com")) {
      return new Response(JSON.stringify({ content: [{ type: "text", text: markdown }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
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

    mode.current = "compare";
    const compareResult = await runCompareTool(
      {
        decision: "Primary database for billing service",
        options: ["PostgreSQL", "MongoDB"],
        layers: 1
      },
      { config }
    );

    assert.equal(compareResult.recommendation, "PostgreSQL");
    assert.ok(compareResult.rationale.length > 0);
    assert.ok(compareResult.analysis.agreements.length > 0);
    assert.equal(compareCalls, 5);

    mode.current = "review";
    const reviewResult = await runReviewTool(
      {
        plan: "1) Deploy service 2) Add tests",
        layers: 1
      },
      { config }
    );

    assert.ok(reviewResult.review.agreements.length > 0);
    assert.ok(reviewResult.review.risks.length > 0);
    assert.equal(reviewCalls, 5);
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
