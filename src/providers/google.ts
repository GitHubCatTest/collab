import type { ProviderClient, ProviderMessage, ProviderRuntimeConfig } from "./types.js";
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

const GOOGLE_DEFAULT_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";

export class GoogleProvider extends BaseProvider implements ProviderClient {
  constructor(runtimeConfig?: ProviderRuntimeConfig) {
    super("google", runtimeConfig);
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

    const systemText = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const contents = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
      }));

    const response = await this.jsonRequest<GoogleResponse>({
      url: resolveGoogleUrl(this.getBaseUrl(runtime.baseUrl, GOOGLE_DEFAULT_BASE_URL), model),
      timeoutMs,
      headers: {
        "x-goog-api-key": apiKey
      },
      body: {
        systemInstruction: {
          parts: [{ text: systemText }]
        },
        contents: contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "" }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens
        }
      }
    });

    const content =
      response.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("\n")
        .trim() || "No response body";

    return this.asCompletion({
      content,
      model,
      promptText: messages.map((message) => message.content).join("\n\n")
    });
  }
}

function resolveGoogleUrl(baseUrl: string, model: string): string {
  if (!baseUrl.includes("{model}")) {
    return baseUrl;
  }

  return baseUrl.replace("{model}", encodeURIComponent(model));
}
