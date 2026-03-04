import type { GenerateResult, ProviderConfig } from "../types/index.js";
import type { ProviderClient, ProviderInvocation } from "./types.js";
import { BaseProvider } from "./base.js";

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

export class OpenAIProvider extends BaseProvider implements ProviderClient {
  constructor() {
    super("openai");
  }

  isConfigured(config: ProviderConfig): boolean {
    return Boolean(process.env[config.apiKeyEnv]);
  }

  async generate(invocation: ProviderInvocation): Promise<GenerateResult> {
    const startMs = Date.now();
    const key = this.getApiKey(invocation.config);
    const prompts = this.buildPrompts(invocation.input);

    const response = await this.jsonRequest<OpenAIResponse>({
      url: invocation.config.baseUrl ?? "https://api.openai.com/v1/responses",
      timeoutMs: invocation.input.timeoutMs,
      headers: {
        Authorization: `Bearer ${key}`
      },
      body: {
        model: invocation.assignment.model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: prompts.system }]
          },
          {
            role: "user",
            content: [{ type: "input_text", text: prompts.user }]
          }
        ],
        max_output_tokens: 1600
      }
    });

    const nested = response.output
      ?.flatMap((item) => item.content ?? [])
      .filter((content) => content.type === "output_text")
      .map((content) => content.text ?? "")
      .join("\n")
      .trim();

    const text =
      response.output_text?.trim() ||
      nested ||
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
