import type { ProviderClient, ProviderMessage, ProviderRuntimeConfig } from "./types.js";
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

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1/responses";

export class OpenAIProvider extends BaseProvider implements ProviderClient {
  constructor(runtimeConfig?: ProviderRuntimeConfig) {
    super("openai", runtimeConfig);
  }

  async complete(
    messages: ProviderMessage[],
    options?: { maxOutputTokens?: number }
  ) {
    const runtime = this.getRuntimeConfig();
    const model = this.getModel(undefined, runtime.model);
    const timeoutMs = this.getTimeoutMs(undefined, runtime);
    const maxOutputTokens = this.getMaxOutputTokens(options?.maxOutputTokens, runtime);
    const apiKey = this.getApiKey(runtime);

    const response = await this.jsonRequest<OpenAIResponse>({
      url: this.getBaseUrl(runtime.baseUrl, OPENAI_DEFAULT_BASE_URL),
      timeoutMs,
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: {
        model,
        input: messages.map((message) => ({
          role: message.role,
          content: [{ type: "input_text", text: message.content }]
        })),
        max_output_tokens: maxOutputTokens
      }
    });

    const nested = response.output
      ?.flatMap((item) => item.content ?? [])
      .filter((content) => content.type === "output_text")
      .map((content) => content.text ?? "")
      .join("\n")
      .trim();

    const content = response.output_text?.trim() || nested || "No response body";

    return this.asCompletion({
      content,
      model,
      promptText: messages.map((message) => message.content).join("\n\n")
    });
  }
}
