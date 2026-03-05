import type { CollabMcpConfig } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { GoogleProvider } from "./google.js";
import { OpenAIProvider } from "./openai.js";
import { SubscriptionProvider } from "./subscription.js";
import type {
  ProviderClient,
  ProviderName,
  ProviderRuntimeConfig,
  ProviderTransport
} from "./types.js";

function uniqueProviderNames(names: ProviderName[]): ProviderName[] {
  return [...new Set(names)];
}

function buildProvider(
  providerName: ProviderName,
  providerConfig: ProviderRuntimeConfig
): ProviderClient {
  const transport = resolveTransport(providerConfig);

  if (transport === "subscription") {
    return new SubscriptionProvider(providerConfig);
  }

  if (providerName === "openai") {
    return new OpenAIProvider(providerConfig);
  }

  if (providerName === "anthropic") {
    return new AnthropicProvider(providerConfig);
  }

  return new GoogleProvider(providerConfig);
}

function resolveTransport(config: ProviderRuntimeConfig): ProviderTransport {
  if (config.transport === "subscription" && config.subscription?.command) {
    return "subscription";
  }

  return "api";
}

export function createProviders(
  config: CollabMcpConfig,
  preferredProviders?: ProviderName[]
): ProviderClient[] {
  const selectedNames = uniqueProviderNames(
    preferredProviders && preferredProviders.length > 0
      ? preferredProviders
      : (Object.keys(config.providers) as ProviderName[])
  );

  const providers: ProviderClient[] = [];
  for (const providerName of selectedNames) {
    const providerConfig = config.providers[providerName];
    if (!providerConfig?.available) {
      continue;
    }

    providers.push(buildProvider(providerName, providerConfig));
  }

  if (providers.length < 2) {
    throw new Error(
      `Collaboration requires at least 2 configured providers, but only ${providers.length} are available.`
    );
  }

  return providers;
}
