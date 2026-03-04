import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  AGENT_ROLES,
  type AgentRole,
  type CollabConfig,
  type ProviderConfig,
  type ProviderName,
  type RunCliOptions
} from "./types/index.js";

const DEFAULT_CONFIG: CollabConfig = {
  roles: {
    architect: { provider: "google", model: "gemini-2.0-pro" },
    implementer: { provider: "openai", model: "gpt-5-codex" },
    reviewer: { provider: "anthropic", model: "claude-opus-4.6" },
    arbiter: { provider: "anthropic", model: "claude-opus-4.6" }
  },
  providers: {
    openrouter: {
      apiKeyEnv: "OPENROUTER_API_KEY",
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
      timeoutMs: 120000
    },
    anthropic: {
      apiKeyEnv: "ANTHROPIC_API_KEY",
      baseUrl: "https://api.anthropic.com/v1/messages",
      timeoutMs: 120000
    },
    google: {
      apiKeyEnv: "GOOGLE_API_KEY",
      baseUrl:
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
      timeoutMs: 120000
    },
    openai: {
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1/responses",
      timeoutMs: 120000
    }
  },
  subscriptionAdapters: [],
  limits: {
    maxRounds: 3,
    budgetUsd: 5,
    timeoutSec: 600
  },
  telemetry: {
    enabled: false
  },
  outputDir: ".collab/sessions"
};

interface LoadConfigArgs {
  cwd: string;
  cli: RunCliOptions;
}

export interface LoadConfigResult {
  config: CollabConfig;
  loadedFiles: string[];
}

export async function loadConfig(args: LoadConfigArgs): Promise<LoadConfigResult> {
  const loadedFiles: string[] = [];

  const userConfigPath = join(homedir(), ".config", "collab", "config.json");
  const projectConfigPath = join(args.cwd, ".collab.json");

  const userConfig = await loadJsonFile<Partial<CollabConfig>>(userConfigPath);
  if (userConfig) {
    loadedFiles.push(userConfigPath);
  }

  const projectConfig = await loadJsonFile<Partial<CollabConfig>>(projectConfigPath);
  if (projectConfig) {
    loadedFiles.push(projectConfigPath);
  }

  const merged = mergeConfig(DEFAULT_CONFIG, userConfig ?? {}, projectConfig ?? {});
  const config = applyCliOverrides(merged, args.cli);
  validateConfig(config);

  return { config, loadedFiles };
}

async function loadJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const typed = error as NodeJS.ErrnoException;
    if (typed.code === "ENOENT") {
      return null;
    }

    throw new Error(`Failed to load config from ${path}: ${typed.message}`);
  }
}

function mergeConfig(
  defaults: CollabConfig,
  user: Partial<CollabConfig>,
  project: Partial<CollabConfig>
): CollabConfig {
  return {
    roles: {
      ...defaults.roles,
      ...(user.roles ?? {}),
      ...(project.roles ?? {})
    },
    providers: mergeProviders(defaults.providers, user.providers, project.providers),
    subscriptionAdapters:
      project.subscriptionAdapters ??
      user.subscriptionAdapters ??
      defaults.subscriptionAdapters,
    limits: {
      ...defaults.limits,
      ...(user.limits ?? {}),
      ...(project.limits ?? {})
    },
    telemetry: {
      ...defaults.telemetry,
      ...(user.telemetry ?? {}),
      ...(project.telemetry ?? {})
    },
    outputDir: project.outputDir ?? user.outputDir ?? defaults.outputDir
  };
}

function mergeProviders(
  defaults: Partial<Record<ProviderName, CollabConfig["providers"][ProviderName]>>,
  user?: Partial<Record<ProviderName, CollabConfig["providers"][ProviderName]>>,
  project?: Partial<Record<ProviderName, CollabConfig["providers"][ProviderName]>>
): CollabConfig["providers"] {
  const providers: CollabConfig["providers"] = {};
  const names: ProviderName[] = ["openrouter", "anthropic", "google", "openai"];

  for (const name of names) {
    const merged = {
      ...(defaults[name] ?? {}),
      ...(user?.[name] ?? {}),
      ...(project?.[name] ?? {})
    };

    if (!merged.apiKeyEnv) {
      throw new Error(`providers.${name}.apiKeyEnv is required`);
    }

    providers[name] = merged as ProviderConfig;
  }

  return providers;
}

function applyCliOverrides(config: CollabConfig, cli: RunCliOptions): CollabConfig {
  return {
    ...config,
    limits: {
      ...config.limits,
      ...(cli.maxRounds ? { maxRounds: cli.maxRounds } : {}),
      ...(cli.budgetUsd ? { budgetUsd: cli.budgetUsd } : {}),
      ...(cli.timeoutSec ? { timeoutSec: cli.timeoutSec } : {})
    },
    outputDir: cli.outDir ?? config.outputDir
  };
}

function validateConfig(config: CollabConfig): void {
  if (config.limits.maxRounds <= 0) {
    throw new Error("limits.maxRounds must be > 0");
  }

  if (config.limits.budgetUsd <= 0) {
    throw new Error("limits.budgetUsd must be > 0");
  }

  if (config.limits.timeoutSec <= 0) {
    throw new Error("limits.timeoutSec must be > 0");
  }

  for (const role of AGENT_ROLES) {
    assertRoleAssignment(role, config);
  }
}

function assertRoleAssignment(role: AgentRole, config: CollabConfig): void {
  const assignment = config.roles[role];
  if (!assignment?.model || !assignment?.provider) {
    throw new Error(`roles.${role} requires provider and model`);
  }

  if (assignment.provider === "adapter" && !assignment.adapter) {
    throw new Error(`roles.${role} uses adapter provider but no adapter name was set`);
  }
}

export function getDefaultConfig(): CollabConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as CollabConfig;
}
