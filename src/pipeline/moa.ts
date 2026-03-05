import {
  buildRefineMessages,
  buildSeedMessages,
  buildSynthesisMessages
} from "./prompts.js";
import { parseStructuredPlan } from "./parser.js";
import type {
  MoaPipelineInput,
  MoaPipelineOutput,
  MoaStage,
  PipelineProvider,
  ProgressEventType,
  StageFailure,
  StageOutput,
  StageResult,
  TokenUsage
} from "./types.js";

const MIN_REQUIRED_SUCCESSES = 2;
const INPUT_TOKEN_RATE_USD = 0.00001;
const OUTPUT_TOKEN_RATE_USD = 0.00003;

interface StageErrorArgs {
  stage: MoaStage;
  layer: number;
  requiredSuccessfulProviders: number;
  successfulProviders: number;
  failures: StageFailure[];
}

interface SettledStageResult {
  successes: StageOutput[];
  failures: StageFailure[];
}

export class MoaStageError extends Error {
  readonly stage: MoaStage;
  readonly layer: number;
  readonly requiredSuccessfulProviders: number;
  readonly successfulProviders: number;
  readonly failures: StageFailure[];

  constructor(args: StageErrorArgs) {
    const failureSummary =
      args.failures.length > 0
        ? ` Failures: ${args.failures
            .map((failure) => `${failure.providerId}: ${failure.error}`)
            .join("; ")}`
        : "";
    super(
      `${capitalize(args.stage)} stage (layer ${args.layer}) requires at least ${args.requiredSuccessfulProviders} successful providers; received ${args.successfulProviders}.${failureSummary}`
    );
    this.name = "MoaStageError";
    this.stage = args.stage;
    this.layer = args.layer;
    this.requiredSuccessfulProviders = args.requiredSuccessfulProviders;
    this.successfulProviders = args.successfulProviders;
    this.failures = args.failures;
  }
}

export async function runMoaPipeline(
  input: MoaPipelineInput
): Promise<MoaPipelineOutput> {
  const startedAtMs = Date.now();
  const providerCount = input.providers.length;
  if (providerCount < MIN_REQUIRED_SUCCESSES) {
    throw new Error(
      `MoA pipeline requires at least ${MIN_REQUIRED_SUCCESSES} providers; received ${providerCount}.`
    );
  }

  const layers = normalizeLayers(input.layers);

  const seed = await runCollaborativeStage({
    providers: input.providers,
    stage: "seed",
    layer: 0,
    requiredSuccesses: MIN_REQUIRED_SUCCESSES,
    maxOutputTokens: input.maxOutputTokens,
    buildMessages: (provider, providerIndex) =>
      buildSeedMessages({
        task: input.task,
        context: input.context,
        focus: input.focus,
        providerId: provider.id,
        providerIndex,
        providerCount
      }),
    onProgress: input.onProgress
  });

  const refinements: StageResult[] = [];
  let currentOutputs = seed.successes;
  for (let layer = 1; layer <= layers; layer += 1) {
    const refine = await runCollaborativeStage({
      providers: input.providers,
      stage: "refine",
      layer,
      requiredSuccesses: MIN_REQUIRED_SUCCESSES,
      maxOutputTokens: input.maxOutputTokens,
      buildMessages: () =>
        buildRefineMessages({
          task: input.task,
          context: input.context,
          focus: input.focus,
          layer,
          priorOutputs: currentOutputs
        }),
      onProgress: input.onProgress
    });

    refinements.push(refine);
    currentOutputs = refine.successes;
  }

  const synthesisStage = await runSynthesisStage({
    providers: input.providers,
    stage: "synthesize",
    layer: layers + 1,
    maxOutputTokens: input.maxOutputTokens,
    preferredProviderId: input.synthesizerId,
    buildMessages: () =>
      buildSynthesisMessages({
        task: input.task,
        context: input.context,
        focus: input.focus,
        priorOutputs: currentOutputs
      }),
    onProgress: input.onProgress
  });

  if (synthesisStage.successes.length === 0) {
    throw new MoaStageError({
      stage: "synthesize",
      layer: layers + 1,
      requiredSuccessfulProviders: 1,
      successfulProviders: 0,
      failures: synthesisStage.failures
    });
  }

  const selectedSynthesis =
    selectPreferredProvider(synthesisStage.successes, input.synthesizerId) ??
    synthesisStage.successes[0];
  const plan = parseStructuredPlan(selectedSynthesis.content);

  const stageSummaries = [seed, ...refinements, synthesisStage];
  const usage = sumTokenUsage(stageSummaries);
  const failedModels = unique(
    stageSummaries.flatMap((stage) => stage.failures.map((failure) => failure.providerId))
  );
  const modelsUsed = unique(
    stageSummaries.flatMap((stage) => stage.successes.map((success) => success.providerId))
  );

  return {
    plan,
    synthesisMarkdown: selectedSynthesis.content,
    meta: {
      modelsUsed,
      layersRun: layers,
      totalTokens: usage.input + usage.output,
      estimatedCostUsd: estimateCostUsd(usage),
      durationMs: Date.now() - startedAtMs,
      failedModels
    }
  };
}

async function runCollaborativeStage(args: {
  providers: PipelineProvider[];
  stage: MoaStage;
  layer: number;
  requiredSuccesses: number;
  maxOutputTokens: number;
  buildMessages: (provider: PipelineProvider, providerIndex: number) => {
    role: "system" | "user" | "assistant";
    content: string;
  }[];
  onProgress?: (message: string) => void | Promise<void>;
}): Promise<StageResult> {
  await emitProgress({
    eventType: "stage_start",
    stage: args.stage,
    layer: args.layer,
    message: `${capitalize(args.stage)} stage started (layer ${args.layer}).`,
    onProgress: args.onProgress
  });

  const settled = await Promise.allSettled(
    args.providers.map((provider, providerIndex) =>
      provider.complete(args.buildMessages(provider, providerIndex), {
        maxOutputTokens: args.maxOutputTokens
      })
    )
  );

  const { successes, failures } = await collectSettledResults({
    settled,
    providers: args.providers,
    stage: args.stage,
    layer: args.layer,
    onProgress: args.onProgress
  });

  await emitProgress({
    eventType: "stage_complete",
    stage: args.stage,
    layer: args.layer,
    message: `${capitalize(args.stage)} stage complete (layer ${args.layer}). successes=${successes.length} failures=${failures.length}`,
    successCount: successes.length,
    failureCount: failures.length,
    onProgress: args.onProgress
  });

  if (successes.length < args.requiredSuccesses) {
    throw new MoaStageError({
      stage: args.stage,
      layer: args.layer,
      requiredSuccessfulProviders: args.requiredSuccesses,
      successfulProviders: successes.length,
      failures
    });
  }

  return {
    stage: args.stage,
    layer: args.layer,
    successes,
    failures
  };
}

async function runSynthesisStage(args: {
  providers: PipelineProvider[];
  stage: MoaStage;
  layer: number;
  maxOutputTokens: number;
  preferredProviderId?: string;
  buildMessages: () => { role: "system" | "user" | "assistant"; content: string }[];
  onProgress?: (message: string) => void | Promise<void>;
}): Promise<StageResult> {
  await emitProgress({
    eventType: "stage_start",
    stage: args.stage,
    layer: args.layer,
    message: `${capitalize(args.stage)} stage started (layer ${args.layer}).`,
    onProgress: args.onProgress
  });

  const preferredProvider = selectPreferredSynthesisProvider(
    args.providers,
    args.preferredProviderId
  );
  const preferredResult = await invokeProviderForStage({
    provider: preferredProvider,
    stage: args.stage,
    layer: args.layer,
    messages: args.buildMessages(),
    maxOutputTokens: args.maxOutputTokens,
    onProgress: args.onProgress
  });

  let successes = preferredResult.success ? [preferredResult.success] : [];
  let failures = preferredResult.failure ? [preferredResult.failure] : [];

  // To control cost, only fan out to fallback synthesizers when the preferred one fails.
  if (successes.length === 0) {
    const fallbackProviders = args.providers.filter(
      (provider) => provider.id !== preferredProvider.id
    );
    const settled = await Promise.allSettled(
      fallbackProviders.map((provider) =>
        provider.complete(args.buildMessages(), { maxOutputTokens: args.maxOutputTokens })
      )
    );

    const fallbackResults = await collectSettledResults({
      settled,
      providers: fallbackProviders,
      stage: args.stage,
      layer: args.layer,
      onProgress: args.onProgress
    });
    successes = fallbackResults.successes;
    failures = [...failures, ...fallbackResults.failures];
  }

  const selected = selectPreferredProvider(successes, args.preferredProviderId);
  const selectedText = selected
    ? ` selected=${selected.providerId}`
    : " selected=(none)";

  await emitProgress({
    eventType: "stage_complete",
    stage: args.stage,
    layer: args.layer,
    message: `${capitalize(args.stage)} stage complete (layer ${args.layer}). successes=${successes.length} failures=${failures.length}${selectedText}`,
    successCount: successes.length,
    failureCount: failures.length,
    onProgress: args.onProgress
  });

  return {
    stage: args.stage,
    layer: args.layer,
    successes,
    failures
  };
}

async function invokeProviderForStage(args: {
  provider: PipelineProvider;
  stage: MoaStage;
  layer: number;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  maxOutputTokens: number;
  onProgress?: (message: string) => void | Promise<void>;
}): Promise<{ success?: StageOutput; failure?: StageFailure }> {
  try {
    const result = await args.provider.complete(args.messages, {
      maxOutputTokens: args.maxOutputTokens
    });
    const success: StageOutput = {
      providerId: args.provider.id,
      model: args.provider.model,
      content: result.content,
      tokens: result.tokens
    };
    await emitProgress({
      eventType: "provider_success",
      stage: args.stage,
      layer: args.layer,
      message: `[${args.stage}] provider=${args.provider.id} status=success`,
      providerId: args.provider.id,
      model: args.provider.model,
      onProgress: args.onProgress
    });
    return { success };
  } catch (error) {
    const message = formatError(error);
    const failure: StageFailure = {
      providerId: args.provider.id,
      model: args.provider.model,
      error: message
    };
    await emitProgress({
      eventType: "provider_error",
      stage: args.stage,
      layer: args.layer,
      message: `[${args.stage}] provider=${args.provider.id} status=error error=${message}`,
      providerId: args.provider.id,
      model: args.provider.model,
      error: message,
      onProgress: args.onProgress
    });
    return { failure };
  }
}

async function collectSettledResults(args: {
  settled: PromiseSettledResult<{ content: string; tokens?: TokenUsage }>[];
  providers: PipelineProvider[];
  stage: MoaStage;
  layer: number;
  onProgress?: (message: string) => void | Promise<void>;
}): Promise<SettledStageResult> {
  const successes: StageOutput[] = [];
  const failures: StageFailure[] = [];

  for (let index = 0; index < args.settled.length; index += 1) {
    const provider = args.providers[index];
    const result = args.settled[index];
    if (result.status === "fulfilled") {
      successes.push({
        providerId: provider.id,
        model: provider.model,
        content: result.value.content,
        tokens: result.value.tokens
      });
      await emitProgress({
        eventType: "provider_success",
        stage: args.stage,
        layer: args.layer,
        message: `[${args.stage}] provider=${provider.id} status=success`,
        providerId: provider.id,
        model: provider.model,
        onProgress: args.onProgress
      });
      continue;
    }

    const error = formatError(result.reason);
    failures.push({
      providerId: provider.id,
      model: provider.model,
      error
    });
    await emitProgress({
      eventType: "provider_error",
      stage: args.stage,
      layer: args.layer,
      message: `[${args.stage}] provider=${provider.id} status=error error=${error}`,
      providerId: provider.id,
      model: provider.model,
      error,
      onProgress: args.onProgress
    });
  }

  return { successes, failures };
}

async function emitProgress(args: {
  eventType: ProgressEventType;
  stage: MoaStage;
  layer: number;
  message: string;
  providerId?: string;
  model?: string;
  successCount?: number;
  failureCount?: number;
  error?: string;
  onProgress?: (message: string) => void | Promise<void>;
}): Promise<void> {
  const envelope = {
    type: args.eventType,
    stage: args.stage,
    layer: args.layer,
    providerId: args.providerId,
    model: args.model,
    successCount: args.successCount,
    failureCount: args.failureCount,
    error: args.error,
    message: args.message
  };
  const serialized = JSON.stringify(envelope);

  if (args.onProgress) {
    try {
      await args.onProgress(serialized);
    } catch {
      // Progress callback failures should not fail the planning pipeline.
    }
  }
}

function normalizeLayers(layers: number): number {
  if (!Number.isFinite(layers) || layers < 1) {
    return 1;
  }

  return Math.floor(layers);
}

function selectPreferredProvider(
  successes: StageOutput[],
  preferredProviderId?: string
): StageOutput | undefined {
  if (!preferredProviderId) {
    return successes[0];
  }

  return successes.find((output) => output.providerId === preferredProviderId) ?? successes[0];
}

function selectPreferredSynthesisProvider(
  providers: PipelineProvider[],
  preferredProviderId?: string
): PipelineProvider {
  if (!preferredProviderId) {
    return providers[0];
  }

  return providers.find((provider) => provider.id === preferredProviderId) ?? providers[0];
}

function sumTokenUsage(stages: StageResult[]): TokenUsage {
  let input = 0;
  let output = 0;

  for (const stage of stages) {
    for (const success of stage.successes) {
      input += success.tokens?.input ?? 0;
      output += success.tokens?.output ?? 0;
    }
  }

  return { input, output };
}

function estimateCostUsd(tokens: TokenUsage): number {
  return Number(
    (tokens.input * INPUT_TOKEN_RATE_USD + tokens.output * OUTPUT_TOKEN_RATE_USD).toFixed(6)
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }

  if (typeof error === "string") {
    return error;
  }

  if (isRecord(error) && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return "unknown error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
