import test from "node:test";
import assert from "node:assert/strict";
import { MoaStageError, runMoaPipeline } from "../src/pipeline/moa.js";
import type {
  MoaPipelineInput,
  PipelineProvider,
  PromptMessage
} from "../src/pipeline/types.js";

interface ScriptedProvider extends PipelineProvider {
  calls: PromptMessage[][];
}

test("runMoaPipeline executes seed/refine/synthesize with graceful degradation", async () => {
  const providers = [
    createScriptedProvider("alpha", [
      "Seed alpha",
      "Refine alpha",
      structuredSynthesis("alpha")
    ]),
    createScriptedProvider("beta", [
      new Error("seed timeout"),
      "Refine beta",
      new Error("synthesis timeout")
    ]),
    createScriptedProvider("gamma", [
      "Seed gamma",
      "Refine gamma",
      structuredSynthesis("gamma")
    ])
  ];

  const progressEvents: Array<{
    type: string;
    stage: string;
    providerId?: string;
    successCount?: number;
  }> = [];

  const input: MoaPipelineInput = {
    task: "Plan rollout strategy for a queue-backed API.",
    context: "Node 20 monorepo, strict SLA.",
    focus: "architecture",
    layers: 1,
    maxOutputTokens: 700,
    providers,
    synthesizerId: "beta",
    onProgress: (message) => {
      progressEvents.push(JSON.parse(message) as (typeof progressEvents)[number]);
    }
  };

  const result = await runMoaPipeline(input);

  assert.equal(result.plan.fallbackUsed, false);
  assert.deepEqual(result.plan.agreements, ["Use feature flags for rollout"]);
  assert.equal(result.meta.layersRun, 1);
  assert.deepEqual(result.meta.modelsUsed, ["alpha", "gamma", "beta"]);
  assert.deepEqual(result.meta.failedModels, ["beta"]);
  assert.ok(result.meta.totalTokens > 0);
  assert.ok(result.meta.durationMs >= 0);
  assert.match(result.synthesisMarkdown, /## Agreements/);
  assert.match(result.synthesisMarkdown, /synthesized-by alpha/i);

  assert.ok(
    progressEvents.some(
      (event) =>
        event.type === "provider_error" &&
        event.stage === "seed" &&
        event.providerId === "beta"
    )
  );
  assert.ok(
    progressEvents.some(
      (event) =>
        event.type === "stage_complete" &&
        event.stage === "synthesize" &&
        event.successCount === 2
    )
  );
});

test("runMoaPipeline throws MoaStageError when fewer than two providers succeed", async () => {
  const providers = [
    createScriptedProvider("alpha", [new Error("auth failed")]),
    createScriptedProvider("beta", ["seed beta"]),
    createScriptedProvider("gamma", [new Error("rate limited")])
  ];

  await assert.rejects(
    runMoaPipeline({
      task: "Design migration plan",
      focus: "general",
      layers: 1,
      maxOutputTokens: 512,
      providers
    }),
    (error: unknown) => {
      assert.ok(error instanceof MoaStageError);
      if (!(error instanceof MoaStageError)) {
        return false;
      }

      assert.equal(error.stage, "seed");
      assert.equal(error.requiredSuccessfulProviders, 2);
      assert.equal(error.successfulProviders, 1);
      assert.match(error.message, /requires at least 2 successful providers/i);
      assert.match(error.message, /alpha: auth failed/i);
      assert.match(error.message, /gamma: rate limited/i);
      return true;
    }
  );
});

function createScriptedProvider(
  id: string,
  script: Array<string | Error>
): ScriptedProvider {
  const queue = [...script];
  const calls: PromptMessage[][] = [];

  return {
    id,
    model: `${id}-model`,
    calls,
    async complete(messages: PromptMessage[]) {
      calls.push(messages);
      const next = queue.shift();
      if (next === undefined) {
        throw new Error(`No scripted response left for provider ${id}`);
      }
      if (next instanceof Error) {
        throw next;
      }
      return {
        content: next,
        tokens: { input: 50, output: 120 }
      };
    }
  };
}

function structuredSynthesis(source: string): string {
  return [
    "## Agreements",
    "- Use feature flags for rollout",
    "",
    "## Disagreements",
    "- Queue backend: Redis vs SQS; recommend SQS for managed operations",
    "",
    "## Tech Stack",
    "- API: Node.js + Fastify",
    "- Data: PostgreSQL",
    "",
    "## Implementation Steps",
    "1. Add queue abstraction",
    "2. Implement worker path",
    "3. Add integration tests",
    "",
    "## Risks",
    "- Potential deploy rollback complexity",
    "",
    `synthesized-by ${source}`
  ].join("\n");
}
