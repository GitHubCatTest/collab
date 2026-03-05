export type ProviderName = "openai" | "anthropic" | "google";

export type ProviderTransport = "api" | "subscription";

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderCompletion {
  content: string;
  model: string;
  tokens?: {
    input: number;
    output: number;
  };
  estimatedCostUsd: number;
}

export interface ProviderSubscriptionRuntimeConfig {
  command: string;
  args: string[];
  timeoutMs: number;
  passEnv?: string[];
}

export interface ProviderRuntimeConfig {
  provider: ProviderName;
  model: string;
  apiKeyEnv: string;
  baseUrl: string;
  timeoutMs: number;
  maxOutputTokens: number;
  transport?: ProviderTransport;
  subscription?: ProviderSubscriptionRuntimeConfig;
  available?: boolean;
}

export interface ProviderClient {
  id: string;
  provider: ProviderName;
  model: string;
  complete(
    messages: ProviderMessage[],
    options?: { maxOutputTokens?: number }
  ): Promise<ProviderCompletion>;
}
