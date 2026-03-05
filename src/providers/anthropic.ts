import type { ProviderClient, ProviderMessage, ProviderRuntimeConfig } from "./types.js";
import { BaseProvider } from "./base.js";

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1/messages";

export class AnthropicProvider extends BaseProvider implements ProviderClient {
  constructor(runtimeConfig?: ProviderRuntimeConfig) {
    super("anthropic", runtimeConfig);
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

    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const conversation = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content
      }));

    const response = await this.jsonRequest<AnthropicResponse>({
      url: this.getBaseUrl(runtime.baseUrl, ANTHROPIC_DEFAULT_BASE_URL),
      timeoutMs,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: {
        model,
        max_tokens: maxOutputTokens,
        system,
        messages: conversation.length > 0 ? conversation : [{ role: "user", content: "" }]
      }
    });

    const content =
      response.content
        ?.filter((item) => item.type === "text" && item.text)
        .map((item) => item.text)
        .join("\n")
        .trim() || "No response body";

    return this.asCompletion({
      content,
      model,
      promptText: messages.map((message) => message.content).join("\n\n")
    });
  }
}
