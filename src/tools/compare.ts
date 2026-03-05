import { z } from "zod";
import { runMoaPipeline } from "../pipeline/moa.js";
import type { StructuredPlan } from "../pipeline/types.js";
import type { CollabMcpConfig } from "../config.js";
import { createProviders } from "../providers/factory.js";
import type { ProviderName } from "../providers/types.js";

const providerNameSchema = z.enum(["openai", "anthropic", "google"]);

export const compareToolInputSchema = z.object({
  decision: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
  context: z.string().optional(),
  layers: z.number().int().min(1).max(3).optional(),
  providers: z.array(providerNameSchema).min(2).optional(),
  synthesizer: providerNameSchema.optional()
});

export type CompareToolInput = z.infer<typeof compareToolInputSchema>;

export interface CompareToolResult {
  recommendation: string;
  rationale: string;
  analysis: StructuredPlan;
  meta: {
    models_used: string[];
    layers_run: number;
    total_tokens: number;
    estimated_cost_usd: number;
    duration_ms: number;
    failed_models: string[];
  };
}

export interface CompareToolDeps {
  config: CollabMcpConfig;
  onProgress?: (message: string) => void | Promise<void>;
}

export async function runCompareTool(
  input: CompareToolInput,
  deps: CompareToolDeps
): Promise<CompareToolResult> {
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

  const task = buildComparisonTask(input);
  const pipelineResult = await runMoaPipeline({
    task,
    context: input.context,
    focus: "general",
    layers,
    maxOutputTokens: deps.config.maxOutputTokens,
    providers,
    synthesizerId,
    onProgress: deps.onProgress
  });

  const { recommendation, rationale } = extractRecommendation(
    pipelineResult.synthesisMarkdown,
    pipelineResult.plan,
    input.options
  );

  return {
    recommendation,
    rationale,
    analysis: pipelineResult.plan,
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

function buildComparisonTask(input: CompareToolInput): string {
  const optionsText = input.options.map((value, index) => `${index + 1}. ${value}`).join("\n");

  return [
    "Compare the following options and recommend the best option for the decision.",
    `Decision: ${input.decision}`,
    "Options:",
    optionsText,
    "In your final synthesis, explicitly include a line that starts with 'Recommendation:' and a line that starts with 'Rationale:' in the Agreements section."
  ].join("\n\n");
}

function extractRecommendation(
  synthesisMarkdown: string,
  plan: StructuredPlan,
  options: string[]
): { recommendation: string; rationale: string } {
  const recommendationMatch = synthesisMarkdown.match(/Recommendation:\s*(.+)/i);
  const rationaleMatch = synthesisMarkdown.match(/Rationale:\s*(.+)/i);

  const recommendation =
    recommendationMatch?.[1]?.trim() ??
    findMentionedOption(plan, options) ??
    options[0];

  const rationale =
    rationaleMatch?.[1]?.trim() ??
    plan.agreements[0] ??
    "Consensus recommendation generated from multi-model review.";

  return { recommendation, rationale };
}

function findMentionedOption(plan: StructuredPlan, options: string[]): string | null {
  const haystack = [
    ...plan.agreements,
    ...plan.disagreements,
    ...plan.techStack
  ]
    .join("\n")
    .toLowerCase();

  for (const option of options) {
    if (haystack.includes(option.toLowerCase())) {
      return option;
    }
  }

  return null;
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
