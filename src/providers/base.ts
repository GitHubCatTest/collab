import type {
  GenerateInput,
  GenerateResult,
  ProviderConfig,
  ProviderName
} from "../types/index.js";

interface JsonRequestArgs {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}

export abstract class BaseProvider {
  constructor(public readonly name: ProviderName) {}

  protected getApiKey(config: ProviderConfig): string {
    const key = process.env[config.apiKeyEnv];
    if (!key) {
      throw new Error(
        `${this.name} provider missing API key in env var ${config.apiKeyEnv}`
      );
    }

    return key;
  }

  protected async jsonRequest<T>(args: JsonRequestArgs): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), args.timeoutMs);

    try {
      const response = await fetch(args.url, {
        method: args.method ?? "POST",
        headers: {
          "content-type": "application/json",
          ...(args.headers ?? {})
        },
        body: args.body === undefined ? undefined : JSON.stringify(args.body),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${this.name} request failed: ${response.status} ${body}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  protected buildPrompts(input: GenerateInput): { system: string; user: string } {
    const system = [
      "You are participating in a multi-model engineering team.",
      "Return concise, implementation-focused output.",
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
      "EVIDENCE:"
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
