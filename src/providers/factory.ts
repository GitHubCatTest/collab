import type { ProviderName } from "../types/index.js";
import { AnthropicProvider } from "./anthropic.js";
import { GoogleProvider } from "./google.js";
import { OpenAIProvider } from "./openai.js";
import { OpenRouterProvider } from "./openrouter.js";
import type { ProviderClient } from "./types.js";

export class ProviderFactory {
  private readonly providers = new Map<ProviderName, ProviderClient>();

  constructor() {
    this.providers.set("openrouter", new OpenRouterProvider());
    this.providers.set("anthropic", new AnthropicProvider());
    this.providers.set("google", new GoogleProvider());
    this.providers.set("openai", new OpenAIProvider());
  }

  get(name: ProviderName): ProviderClient {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Unsupported provider: ${name}`);
    }

    return provider;
  }

  list(): ProviderClient[] {
    return [...this.providers.values()];
  }
}
