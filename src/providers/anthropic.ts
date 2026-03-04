import type { GenerateResult, ProviderConfig } from "../types/index.js";
import type { ProviderClient, ProviderInvocation } from "./types.js";
import { BaseProvider } from "./base.js";

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

export class AnthropicProvider extends BaseProvider implements ProviderClient {
  constructor() {
    super("anthropic");
  }

  isConfigured(config: ProviderConfig): boolean {
    return Boolean(process.env[config.apiKeyEnv]);
  }

  async generate(invocation: ProviderInvocation): Promise<GenerateResult> {
    const startMs = Date.now();
    const key = this.getApiKey(invocation.config);
    const prompts = this.buildPrompts(invocation.input);

    const response = await this.jsonRequest<AnthropicResponse>({
      url: invocation.config.baseUrl ?? "https://api.anthropic.com/v1/messages",
      timeoutMs: invocation.input.timeoutMs,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: {
        model: invocation.assignment.model,
        max_tokens: 1600,
        system: prompts.system,
        messages: [{ role: "user", content: prompts.user }]
      }
    });

    const text =
      response.content
        ?.filter((item) => item.type === "text" && item.text)
        .map((item) => item.text)
        .join("\n")
        .trim() ||
      "SUMMARY:\nNo response body\n\nDIFF_PLAN:\nNone\n\nRISKS:\n- Provider returned empty content\n\nTESTS:\n- Validate provider integration\n\nEVIDENCE:\n- Empty provider response";

    return this.finalizeResult(
      this.name,
      invocation.assignment.model,
      text,
      startMs,
      invocation.input
    );
  }
}
