import type { GenerateResult, ProviderConfig } from "../types/index.js";
import type { ProviderClient, ProviderInvocation } from "./types.js";
import { BaseProvider } from "./base.js";

interface GoogleResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

export class GoogleProvider extends BaseProvider implements ProviderClient {
  constructor() {
    super("google");
  }

  isConfigured(config: ProviderConfig): boolean {
    return Boolean(process.env[config.apiKeyEnv]);
  }

  async generate(invocation: ProviderInvocation): Promise<GenerateResult> {
    const startMs = Date.now();
    const key = this.getApiKey(invocation.config);
    const prompts = this.buildPrompts(invocation.input);

    const baseUrl =
      invocation.config.baseUrl ??
      "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
    const url = baseUrl.replace("{model}", invocation.assignment.model);

    const response = await this.jsonRequest<GoogleResponse>({
      url,
      timeoutMs: invocation.input.timeoutMs,
      headers: {
        "x-goog-api-key": key
      },
      body: {
        systemInstruction: {
          parts: [{ text: prompts.system }]
        },
        contents: [{ role: "user", parts: [{ text: prompts.user }] }],
        generationConfig: {
          temperature: 0.3
        }
      }
    });

    const text =
      response.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
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
