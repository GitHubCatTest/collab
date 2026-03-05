import type {
  ProviderName,
  ProviderRuntimeConfig,
  ProviderTransport
} from "./providers/types.js";

export interface CollabMcpProviderConfig extends ProviderRuntimeConfig {
  available: boolean;
}

export interface CollabMcpConfig {
  defaultLayers: number;
  maxLayers: number;
  timeoutMs: number;
  maxOutputTokens: number;
  defaultSynthesizer: ProviderName;
  providers: Record<ProviderName, CollabMcpProviderConfig>;
}

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1200;
const DEFAULT_LAYERS = 2;
const DEFAULT_MAX_LAYERS = 4;
const DEFAULT_SYNTHESIZER: ProviderName = "anthropic";
const DEFAULT_PROVIDER_TRANSPORT: ProviderTransport = "api";

const PROVIDER_DEFAULTS: Record<
  ProviderName,
  {
    provider: ProviderName;
    apiKeyEnv: string;
    baseUrl: string;
    modelEnv: string;
    model: string;
  }
> = {
  openai: {
    provider: "openai",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1/responses",
    modelEnv: "COLLAB_OPENAI_MODEL",
    model: "gpt-4o-mini"
  },
  anthropic: {
    provider: "anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com/v1/messages",
    modelEnv: "COLLAB_ANTHROPIC_MODEL",
    model: "claude-3-5-haiku-latest"
  },
  google: {
    provider: "google",
    apiKeyEnv: "GOOGLE_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    modelEnv: "COLLAB_GOOGLE_MODEL",
    model: "gemini-2.0-flash"
  }
};

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CollabMcpConfig {
  const timeoutMs = parseIntInRange(env.COLLAB_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 300000);
  const maxOutputTokens = parseIntInRange(
    env.COLLAB_MAX_OUTPUT_TOKENS,
    DEFAULT_MAX_OUTPUT_TOKENS,
    128,
    8192
  );
  const maxLayers = parseIntInRange(env.COLLAB_MAX_LAYERS, DEFAULT_MAX_LAYERS, 1, 8);
  const defaultLayers = parseIntInRange(env.COLLAB_DEFAULT_LAYERS, DEFAULT_LAYERS, 1, maxLayers);
  const defaultSynthesizer = parseProviderName(
    env.COLLAB_DEFAULT_SYNTHESIZER,
    DEFAULT_SYNTHESIZER
  );

  const providers = Object.fromEntries(
    (Object.entries(PROVIDER_DEFAULTS) as Array<
      [
        ProviderName,
        {
          provider: ProviderName;
          apiKeyEnv: string;
          baseUrl: string;
          modelEnv: string;
          model: string;
        }
      ]
    >).map(([name, defaults]) => {
      const model = sanitizeString(env[defaults.modelEnv]) ?? defaults.model;
      const apiKeyValue = sanitizeString(env[defaults.apiKeyEnv]);
      const providerPrefix = `COLLAB_${name.toUpperCase()}`;
      const transport = parseProviderTransport(
        env[`${providerPrefix}_TRANSPORT`],
        DEFAULT_PROVIDER_TRANSPORT
      );
      const adapterCommand = sanitizeString(env[`${providerPrefix}_ADAPTER_COMMAND`]);
      const adapterArgs = parseJsonStringArray(env[`${providerPrefix}_ADAPTER_ARGS`]);
      const adapterTimeoutMs =
        parseOptionalIntInRange(env[`${providerPrefix}_ADAPTER_TIMEOUT_MS`], 100, 300000) ??
        timeoutMs;
      const adapterPassEnv = parseEnvKeyArray(env[`${providerPrefix}_ADAPTER_PASS_ENV`]);

      const subscription = adapterCommand
        ? {
            command: adapterCommand,
            args: adapterArgs,
            timeoutMs: adapterTimeoutMs,
            passEnv: adapterPassEnv
          }
        : undefined;

      const providerConfig: CollabMcpProviderConfig = {
        provider: defaults.provider,
        model,
        apiKeyEnv: defaults.apiKeyEnv,
        baseUrl: defaults.baseUrl,
        timeoutMs,
        maxOutputTokens,
        transport,
        subscription,
        available:
          transport === "subscription" ? Boolean(subscription?.command) : Boolean(apiKeyValue)
      };

      return [name, providerConfig];
    })
  ) as Record<ProviderName, CollabMcpProviderConfig>;

  return {
    defaultLayers,
    maxLayers,
    timeoutMs,
    maxOutputTokens,
    defaultSynthesizer,
    providers
  };
}

function parseIntInRange(
  rawValue: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const value = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}

function parseOptionalIntInRange(
  rawValue: string | undefined,
  min: number,
  max: number
): number | undefined {
  const value = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isFinite(value)) {
    return undefined;
  }

  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}

function parseProviderName(
  rawValue: string | undefined,
  fallback: ProviderName
): ProviderName {
  const value = sanitizeString(rawValue);
  if (value === "openai" || value === "anthropic" || value === "google") {
    return value;
  }

  return fallback;
}

function parseProviderTransport(
  rawValue: string | undefined,
  fallback: ProviderTransport
): ProviderTransport {
  const value = sanitizeString(rawValue)?.toLowerCase();
  if (value === "api" || value === "subscription") {
    return value;
  }

  return fallback;
}

function parseJsonStringArray(rawValue: string | undefined): string[] {
  const value = sanitizeString(rawValue);
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim());
  } catch {
    return [];
  }
}

function parseEnvKeyArray(rawValue: string | undefined): string[] {
  const values = parseJsonStringArray(rawValue);
  return values.filter((key) => /^[A-Z_][A-Z0-9_]*$/.test(key));
}

function sanitizeString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
