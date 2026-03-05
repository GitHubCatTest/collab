import { z } from "zod";
import { runMoaPipeline } from "../pipeline/moa.js";
import type { StructuredPlan } from "../pipeline/types.js";
import type { CollabMcpConfig } from "../config.js";
import { createProviders } from "../providers/factory.js";
import type { ProviderName } from "../providers/types.js";

const providerNameSchema = z.enum(["openai", "anthropic", "google"]);

export const reviewToolInputSchema = z.object({
  plan: z.string().min(1),
  objective: z.string().optional(),
  constraints: z.string().optional(),
  layers: z.number().int().min(1).max(3).optional(),
  providers: z.array(providerNameSchema).min(2).optional(),
  synthesizer: providerNameSchema.optional()
});

export type ReviewToolInput = z.infer<typeof reviewToolInputSchema>;

export interface ReviewToolResult {
  review: StructuredPlan;
  meta: {
    models_used: string[];
    layers_run: number;
    total_tokens: number;
    estimated_cost_usd: number;
    duration_ms: number;
    failed_models: string[];
  };
}

export interface ReviewToolDeps {
  config: CollabMcpConfig;
  onProgress?: (message: string) => void | Promise<void>;
}

export async function runReviewTool(
  input: ReviewToolInput,
  deps: ReviewToolDeps
): Promise<ReviewToolResult> {
  const providers = createProviders(deps.config, input.providers);
  const layers = Math.min(
    Math.max(input.layers ?? 1, 1),
    Math.min(3, deps.config.maxLayers)
  );
  const synthesizerId = pickSynthesizer(
    providers.map((provider) => provider.provider),
    input.synthesizer,
    deps.config.defaultSynthesizer
  );

  const reviewTask = buildReviewTask(input);
  const pipelineResult = await runMoaPipeline({
    task: reviewTask,
    focus: "implementation",
    layers,
    maxOutputTokens: deps.config.maxOutputTokens,
    providers,
    synthesizerId,
    onProgress: deps.onProgress
  });

  return {
    review: pipelineResult.plan,
    meta: {
      models_used: pipelineResult.meta.modelsUsed,
      layers_run: pipelineResult.meta.layersRun,
      total_tokens: pipelineResult.meta.totalTokens,
      estimated_cost_usd: pipelineResult.meta.estimatedCostUsd,
      duration_ms: pipelineResult.meta.durationMs,
      failed_models: pipelineResult.meta.failedModels
    }
  };
}

function buildReviewTask(input: ReviewToolInput): string {
  const objectiveLine = input.objective ? `Objective: ${input.objective}` : "Objective: Improve plan quality.";
  const constraintsLine =
    input.constraints !== undefined
      ? `Constraints: ${input.constraints}`
      : "Constraints: Keep recommendations pragmatic and low complexity.";

  return [
    "Review the following implementation plan.",
    objectiveLine,
    constraintsLine,
    "Identify missing steps, hidden risks, sequencing problems, and stronger alternatives.",
    "Current plan:",
    input.plan
  ].join("\n\n");
}

function pickSynthesizer(
  selectedProviders: ProviderName[],
  requested: ProviderName | undefined,
  fallback: ProviderName
): ProviderName {
  if (requested) {
    if (!selectedProviders.includes(requested)) {
      throw new Error(
        `Requested synthesizer '${requested}' was not selected in providers.`
      );
    }

    return requested;
  }

  if (selectedProviders.includes(fallback)) {
    return fallback;
  }

  return selectedProviders[0];
}
