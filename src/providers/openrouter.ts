import type { GenerateResult, ProviderConfig } from "../types/index.js";
import type { ProviderClient, ProviderInvocation } from "./types.js";
import { BaseProvider } from "./base.js";

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export class OpenRouterProvider
  extends BaseProvider
  implements ProviderClient
{
  constructor() {
    super("openrouter");
  }

  isConfigured(config: ProviderConfig): boolean {
    return Boolean(process.env[config.apiKeyEnv]);
  }

  async generate(invocation: ProviderInvocation): Promise<GenerateResult> {
    const startMs = Date.now();
    const key = this.getApiKey(invocation.config);
    const prompts = this.buildPrompts(invocation.input);

    const response = await this.jsonRequest<OpenRouterResponse>({
      url: invocation.config.baseUrl ?? "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${key}`
      },
      timeoutMs: invocation.input.timeoutMs,
      body: {
        model: invocation.assignment.model,
        messages: [
          { role: "system", content: prompts.system },
          { role: "user", content: prompts.user }
        ],
        temperature: 0.3
      }
    });

    const text =
      response.choices?.[0]?.message?.content?.trim() ??
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
