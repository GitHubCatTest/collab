import type {
  ProviderCompletion,
  ProviderMessage,
  ProviderName,
  ProviderRuntimeConfig
} from "./types.js";
import {
  ProviderRequestError,
  classifyHttpError,
  classifyUnknownError
} from "./errors.js";

export interface JsonRequestArgs {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  retryJitterMs?: number;
}

export abstract class BaseProvider {
  readonly id: string;
  readonly provider: ProviderName;
  readonly model: string;
  private readonly runtimeConfig?: ProviderRuntimeConfig;

  constructor(provider: ProviderName, runtimeConfig?: ProviderRuntimeConfig) {
    this.id = provider;
    this.provider = provider;
    this.model = runtimeConfig?.model ?? "unknown";
    this.runtimeConfig = runtimeConfig;
  }

  abstract complete(
    messages: ProviderMessage[],
    options?: { maxOutputTokens?: number }
  ): Promise<ProviderCompletion>;

  protected getRuntimeConfig(): ProviderRuntimeConfig {
    if (!this.runtimeConfig) {
      throw new ProviderRequestError({
        message: `${this.provider} provider runtime config is missing`,
        code: "invalid_request",
        retryable: false
      });
    }

    return this.runtimeConfig;
  }

  protected getApiKey(config?: ProviderRuntimeConfig): string {
    const apiKeyEnv = config?.apiKeyEnv ?? this.runtimeConfig?.apiKeyEnv;
    if (!apiKeyEnv) {
      throw new ProviderRequestError({
        message: `${this.provider} provider apiKeyEnv is not configured`,
        code: "invalid_request",
        retryable: false
      });
    }

    const key = process.env[apiKeyEnv];
    if (!key) {
      throw new ProviderRequestError({
        message: `${this.provider} provider missing API key in env var ${apiKeyEnv}`,
        code: "auth",
        retryable: false
      });
    }

    return key;
  }

  protected async jsonRequest<T>(args: JsonRequestArgs): Promise<T> {
    const maxRetries = args.maxRetries ?? 2;
    const retryBaseDelayMs = Math.max(0, args.retryBaseDelayMs ?? 250);
    const retryMaxDelayMs = Math.max(retryBaseDelayMs, args.retryMaxDelayMs ?? 2000);
    const retryJitterMs = Math.max(0, args.retryJitterMs ?? 120);

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(args);

        if (!response.ok) {
          const body = await response.text();
          const classified = classifyHttpError(response.status);

          throw new ProviderRequestError({
            message: `${this.provider} request failed: ${response.status} ${body}`,
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

        const delayMs =
          retryBaseDelayMs * 2 ** attempt + Math.floor(Math.random() * retryJitterMs);
        if (delayMs > 0) {
          await sleep(Math.min(delayMs, retryMaxDelayMs));
        }
      }
    }

    throw new ProviderRequestError({
      message: `${this.provider} request failed after retries`,
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

  protected getTimeoutMs(
    explicitTimeoutMs: number | undefined,
    config?: ProviderRuntimeConfig
  ): number {
    return explicitTimeoutMs ?? config?.timeoutMs ?? this.runtimeConfig?.timeoutMs ?? 60000;
  }

  protected getMaxOutputTokens(
    explicitMaxOutputTokens: number | undefined,
    config?: ProviderRuntimeConfig
  ): number {
    if (isPositiveInteger(explicitMaxOutputTokens)) {
      return explicitMaxOutputTokens;
    }

    if (isPositiveInteger(config?.maxOutputTokens)) {
      return config.maxOutputTokens;
    }

    if (isPositiveInteger(this.runtimeConfig?.maxOutputTokens)) {
      return this.runtimeConfig.maxOutputTokens;
    }

    return 1200;
  }

  protected getModel(explicitModel: string | undefined, fallbackModel?: string): string {
    const candidate =
      explicitModel?.trim() ?? fallbackModel?.trim() ?? this.runtimeConfig?.model?.trim();
    if (!candidate) {
      throw new ProviderRequestError({
        message: `${this.provider} provider model is not configured`,
        code: "invalid_request",
        retryable: false
      });
    }

    return candidate;
  }

  protected getBaseUrl(explicitBaseUrl: string | undefined, fallbackBaseUrl?: string): string {
    const candidate = explicitBaseUrl ?? fallbackBaseUrl ?? this.runtimeConfig?.baseUrl;
    if (!candidate) {
      throw new ProviderRequestError({
        message: `${this.provider} provider base URL is not configured`,
        code: "invalid_request",
        retryable: false
      });
    }

    return candidate;
  }

  protected asCompletion(args: {
    content: string;
    model: string;
    promptText?: string;
  }): ProviderCompletion {
    const inputTokens = estimateTokenCount(args.promptText ?? "");
    const outputTokens = estimateTokenCount(args.content);

    return {
      content: args.content,
      model: args.model,
      tokens: {
        input: inputTokens,
        output: outputTokens
      },
      estimatedCostUsd: Number(
        (inputTokens * 0.000001 + outputTokens * 0.000003).toFixed(6)
      )
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPositiveInteger(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
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
