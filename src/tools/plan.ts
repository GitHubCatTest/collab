import { z } from "zod";
import { runMoaPipeline } from "../pipeline/moa.js";
import type { CollaborationFocus, StructuredPlan } from "../pipeline/types.js";
import { createProviders } from "../providers/factory.js";
import type { ProviderName } from "../providers/types.js";
import type { CollabMcpConfig } from "../config.js";

const providerNameSchema = z.enum(["openai", "anthropic", "google"]);

export const planToolInputSchema = z.object({
  task: z.string().min(1),
  context: z.string().optional(),
  layers: z.number().int().min(1).max(4).optional(),
  focus: z
    .enum(["architecture", "techstack", "implementation", "security", "general"])
    .optional(),
  providers: z.array(providerNameSchema).min(2).optional(),
  synthesizer: providerNameSchema.optional()
});

export type PlanToolInput = z.infer<typeof planToolInputSchema>;

export interface StructuredDisagreement {
  topic: string;
  positions: Array<{
    model: string;
    position: string;
  }>;
}

export interface StructuredTechStackItem {
  category: string;
  choice: string;
  reasoning: string;
  alternatives: string[];
}

export interface StructuredImplementationStep {
  order: number;
  title: string;
  description: string;
  estimated_effort: string;
}

export interface StructuredRisk {
  risk: string;
  severity: "low" | "medium" | "high";
  identified_by: string;
}

export interface StructuredPlanOutput {
  agreements: string[];
  disagreements: StructuredDisagreement[];
  tech_stack: StructuredTechStackItem[];
  implementation_steps: StructuredImplementationStep[];
  risks: StructuredRisk[];
}

export interface PlanToolResult {
  plan: StructuredPlanOutput;
  meta: {
    models_used: string[];
    layers_run: number;
    total_tokens: number;
    estimated_cost_usd: number;
    duration_ms: number;
    failed_models: string[];
    fallback_parser_used: boolean;
  };
}

export interface PlanToolDeps {
  config: CollabMcpConfig;
  onProgress?: (message: string) => void | Promise<void>;
}

export async function runPlanTool(
  input: PlanToolInput,
  deps: PlanToolDeps
): Promise<PlanToolResult> {
  const providers = createProviders(deps.config, input.providers);
  const layers = clampLayers(input.layers ?? deps.config.defaultLayers, deps.config.maxLayers);
  const focus = (input.focus ?? "general") as CollaborationFocus;
  const synthesizerId = pickSynthesizer(
    providers.map((provider) => provider.provider),
    input.synthesizer,
    deps.config.defaultSynthesizer
  );

  const pipelineResult = await runMoaPipeline({
    task: input.task,
    context: input.context,
    focus,
    layers,
    maxOutputTokens: deps.config.maxOutputTokens,
    providers,
    synthesizerId,
    onProgress: deps.onProgress
  });

  return {
    plan: normalizeStructuredPlan(pipelineResult.plan),
    meta: {
      models_used: pipelineResult.meta.modelsUsed,
      layers_run: pipelineResult.meta.layersRun,
      total_tokens: pipelineResult.meta.totalTokens,
      estimated_cost_usd: pipelineResult.meta.estimatedCostUsd,
      duration_ms: pipelineResult.meta.durationMs,
      failed_models: pipelineResult.meta.failedModels,
      fallback_parser_used: pipelineResult.plan.fallbackUsed
    }
  };
}

export function normalizeStructuredPlan(plan: StructuredPlan): StructuredPlanOutput {
  return {
    agreements: plan.agreements,
    disagreements: plan.disagreements.map((entry) => ({
      topic: summarizeTopic(entry),
      positions: [
        {
          model: "synthesis",
          position: entry
        }
      ]
    })),
    tech_stack: plan.techStack.map((entry) => parseTechStackItem(entry)),
    implementation_steps: plan.implementationSteps.map((entry, index) =>
      parseImplementationStep(entry, index)
    ),
    risks: plan.risks.map((entry) => ({
      risk: entry,
      severity: inferSeverity(entry),
      identified_by: "multi-model synthesis"
    }))
  };
}

function parseTechStackItem(entry: string): StructuredTechStackItem {
  const [categoryPart, restPart] = splitOnce(entry, ":");
  if (!restPart) {
    return {
      category: "General",
      choice: entry,
      reasoning: "Recommended by the collaborative synthesis.",
      alternatives: []
    };
  }

  const [choicePart, reasoningPart] = splitOnce(restPart, " - ");
  const [choice, alternatives] = extractAlternatives(choicePart);

  return {
    category: categoryPart,
    choice,
    reasoning: reasoningPart || "Recommended by the collaborative synthesis.",
    alternatives
  };
}

function parseImplementationStep(
  entry: string,
  index: number
): StructuredImplementationStep {
  const clean = entry.replace(/^\d+[.)]\s*/, "").trim();
  const [titlePart, descriptionPart] = splitOnce(clean, ":");

  return {
    order: index + 1,
    title: titlePart || `Step ${index + 1}`,
    description: descriptionPart || clean,
    estimated_effort: estimateEffort(clean)
  };
}

function summarizeTopic(entry: string): string {
  const [topic] = splitOnce(entry, ":");
  return topic || entry.slice(0, 80);
}

function inferSeverity(value: string): "low" | "medium" | "high" {
  const text = value.toLowerCase();
  if (/critical|outage|data loss|security breach|leak|incident/.test(text)) {
    return "high";
  }

  if (/rollback|latency|performance|failure|downtime/.test(text)) {
    return "medium";
  }

  return "low";
}

function estimateEffort(value: string): string {
  const text = value.toLowerCase();
  if (/migrate|redesign|rewrite|cross-team|infrastructure/.test(text)) {
    return "2-5 days";
  }

  if (/implement|integrate|validate|test/.test(text)) {
    return "0.5-2 days";
  }

  return "2-6 hours";
}

function splitOnce(value: string, separator: string): [string, string] {
  const index = value.indexOf(separator);
  if (index < 0) {
    return [value.trim(), ""];
  }

  return [
    value.slice(0, index).trim(),
    value.slice(index + separator.length).trim()
  ];
}

function extractAlternatives(choicePart: string): [string, string[]] {
  const pieces = choicePart
    .split(/\s+vs\s+/i)
    .map((piece) => piece.trim())
    .filter(Boolean);

  if (pieces.length <= 1) {
    return [choicePart.trim(), []];
  }

  return [pieces[0], pieces.slice(1)];
}

function clampLayers(value: number, maxLayers: number): number {
  return Math.min(Math.max(value, 1), maxLayers);
}

function pickSynthesizer(
  selectedProviders: ProviderName[],
  requested: ProviderName | undefined,
  fallback: ProviderName
): ProviderName {
  if (requested) {
    if (!selectedProviders.includes(requested)) {
      throw new Error(`Requested synthesizer '${requested}' was not selected in providers.`);
    }

    return requested;
  }

  if (selectedProviders.includes(fallback)) {
    return fallback;
  }

  return selectedProviders[0];
}
