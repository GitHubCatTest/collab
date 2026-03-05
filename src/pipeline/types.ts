export type CollaborationFocus =
  | "architecture"
  | "techstack"
  | "implementation"
  | "security"
  | "general";

export type PromptRole = "system" | "user" | "assistant";

export interface PromptMessage {
  role: PromptRole;
  content: string;
}

export interface TokenUsage {
  input: number;
  output: number;
}

export interface PipelineProvider {
  id: string;
  model: string;
  complete(
    messages: PromptMessage[],
    options?: { maxOutputTokens?: number }
  ): Promise<{ content: string; tokens?: TokenUsage }>;
}

export interface MoaPipelineInput {
  task: string;
  context?: string;
  focus: CollaborationFocus;
  layers: number;
  maxOutputTokens: number;
  providers: PipelineProvider[];
  synthesizerId?: string;
  onProgress?: (message: string) => void | Promise<void>;
}

export type MoaStage = "seed" | "refine" | "synthesize";

export interface StageOutput {
  providerId: string;
  model: string;
  content: string;
  tokens?: TokenUsage;
}

export interface StageFailure {
  providerId: string;
  model: string;
  error: string;
}

export interface StageResult {
  stage: MoaStage;
  layer: number;
  successes: StageOutput[];
  failures: StageFailure[];
}

export type PlanSectionKey =
  | "agreements"
  | "disagreements"
  | "techStack"
  | "implementationSteps"
  | "risks";

export interface StructuredPlan {
  agreements: string[];
  disagreements: string[];
  techStack: string[];
  implementationSteps: string[];
  risks: string[];
  rawSections: Partial<Record<PlanSectionKey, string>>;
  missingSections: PlanSectionKey[];
  fallbackUsed: boolean;
}

export interface MoaPipelineMeta {
  // Legacy contract: these identifiers map to provider IDs (openai/anthropic/google).
  modelsUsed: string[];
  layersRun: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  // Legacy contract: these identifiers map to provider IDs.
  failedModels: string[];
}

export interface MoaPipelineOutput {
  plan: StructuredPlan;
  synthesisMarkdown: string;
  meta: MoaPipelineMeta;
}

export type ProgressEventType =
  | "stage_start"
  | "provider_success"
  | "provider_error"
  | "stage_complete";

export interface PipelineProgressEvent {
  type: ProgressEventType;
  stage: MoaStage;
  layer: number;
  message: string;
  providerId?: string;
  model?: string;
  successCount?: number;
  failureCount?: number;
  error?: string;
}

export type ProgressCallback = (event: PipelineProgressEvent) => void | Promise<void>;
