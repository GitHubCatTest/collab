import type {
  GenerateInput,
  GenerateResult,
  ProviderConfig,
  ProviderName
} from "../types/index.js";
import {
  ProviderRequestError,
  classifyHttpError,
  classifyUnknownError
} from "./errors.js";

interface JsonRequestArgs {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  maxRetries?: number;
}

export abstract class BaseProvider {
  constructor(public readonly name: ProviderName) {}

  protected getApiKey(config: ProviderConfig): string {
    const key = process.env[config.apiKeyEnv];
    if (!key) {
      throw new ProviderRequestError({
        message: `${this.name} provider missing API key in env var ${config.apiKeyEnv}`,
        code: "auth",
        retryable: false
      });
    }

    return key;
  }

  protected async jsonRequest<T>(args: JsonRequestArgs): Promise<T> {
    const maxRetries = args.maxRetries ?? 2;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(args);

        if (!response.ok) {
          const body = await response.text();
          const classified = classifyHttpError(response.status);

          throw new ProviderRequestError({
            message: `${this.name} request failed: ${response.status} ${body}`,
            code: classified.code,
            retryable: classified.retryable,
            status: response.status,
            responseBody: body
          });
        }

        return (await response.json()) as T;
      } catch (error) {
        const typed = normalizeProviderError(error);
        const isFinalAttempt = attempt >= maxRetries;
        if (!typed.retryable || isFinalAttempt) {
          throw typed;
        }

        const delayMs = 250 * 2 ** attempt + Math.floor(Math.random() * 120);
        // Retry transient provider/network issues with capped backoff.
        await sleep(Math.min(delayMs, 2000));
      }
    }

    throw new ProviderRequestError({
      message: `${this.name} request failed after retries`,
      code: "unknown",
      retryable: false
    });
  }

  private async fetchWithTimeout(args: JsonRequestArgs): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), args.timeoutMs);

    try {
      return await fetch(args.url, {
        method: args.method ?? "POST",
        headers: {
          "content-type": "application/json",
          ...(args.headers ?? {})
        },
        body: args.body === undefined ? undefined : JSON.stringify(args.body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  protected buildPrompts(input: GenerateInput): { system: string; user: string } {
    const system = [
      "You are participating in a multi-model engineering team.",
      "Focus on planning quality and repository-grounded implementation details.",
      "Do not expose private chain-of-thought."
    ].join(" ");

    const user = [
      `Role: ${input.role}`,
      `Round: ${input.round}`,
      `Task: ${input.task}`,
      "Shared board summary:",
      input.boardSummary || "(empty)",
      "Return this format:",
      "SUMMARY:",
      "DIFF_PLAN:",
      "RISKS:",
      "TESTS:",
      "EVIDENCE:",
      "PATCH_DIFF: (optional unified diff)"
    ].join("\n\n");

    return { system, user };
  }

  protected finalizeResult(
    provider: ProviderName,
    model: string,
    text: string,
    startMs: number,
    input: GenerateInput
  ): GenerateResult {
    const latencyMs = Date.now() - startMs;
    const estimatedCostUsd = estimateCostUsd(input, text);

    return {
      text,
      provider,
      model,
      latencyMs,
      estimatedCostUsd
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeProviderError(error: unknown): ProviderRequestError {
  if (error instanceof ProviderRequestError) {
    return error;
  }

  const classified = classifyUnknownError(error);
  return new ProviderRequestError({
    message: classified.message,
    code: classified.code,
    retryable: classified.retryable
  });
}

export function estimateCostUsd(input: GenerateInput, outputText: string): number {
  const estimatedInputTokens = Math.max(
    50,
    Math.ceil((input.task.length + input.boardSummary.length + 220) / 4)
  );
  const estimatedOutputTokens = Math.max(50, Math.ceil(outputText.length / 4));

  // Conservative blended estimate for mixed frontier models.
  const inputRate = 0.00001;
  const outputRate = 0.00003;

  return Number(
    (estimatedInputTokens * inputRate + estimatedOutputTokens * outputRate).toFixed(6)
  );
}
