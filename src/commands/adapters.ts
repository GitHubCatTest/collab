import { execFile, type ExecFileException } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AdapterRegistry } from "../adapters/registry.js";
import {
  AdapterRuntimeError,
  buildAdapterEnv,
  runSubprocessAdapter
} from "../adapters/subprocessAdapter.js";
import { loadConfig } from "../config.js";
import { redactSensitiveText } from "../safety/redaction.js";
import type { SubscriptionAdapterConfig } from "../types/index.js";

const ADAPTER_CLI_TIMEOUT_MS = 30_000;

type HealthCheckStatus = "pass" | "fail" | "skipped";
type HealthCheckFailureCode = "not-found" | "timeout" | "non-zero-exit";

interface HealthCheckResult {
  status: HealthCheckStatus;
  code?: HealthCheckFailureCode;
  detail?: string;
}

interface AdapterGlobalArgs {
  repoPath?: string;
  rest: string[];
}

export async function adaptersCommand(args: string[]): Promise<number> {
  const parsed = parseAdapterGlobalArgs(args);
  const subcommand = parsed.rest[0];

  if (!subcommand || subcommand === "list") {
    return listAdaptersCommand(parsed.repoPath);
  }

  if (subcommand === "--help" || subcommand === "-h") {
    printAdaptersUsage();
    return 0;
  }

  if (subcommand === "test") {
    const name = parsed.rest[1];
    if (!name || name.startsWith("--")) {
      throw new Error("Usage: collab adapters test <name> [--repo <path>]");
    }

    return testAdapterCommand(name, parsed.repoPath);
  }

  if (subcommand === "doctor") {
    return adaptersDoctorCommand(parsed.repoPath);
  }

  if (subcommand === "init") {
    const initArgs = parseInitArgs(parsed.rest.slice(1));
    return adaptersInitCommand(initArgs.preset, parsed.repoPath);
  }

  throw new Error(
    "Usage: collab adapters <list|test <name>|doctor|init --preset tri-subscription> [--repo <path>]"
  );
}

export async function listAdaptersCommand(repoPathArg?: string): Promise<number> {
  const repoPath = resolve(repoPathArg ?? process.cwd());
  const { config } = await loadConfig({
    cwd: repoPath,
    cli: {}
  });

  const registry = new AdapterRegistry(config);
  const diagnostics = await registry.diagnostics();

  if (diagnostics.length === 0) {
    console.log("No subscription adapters configured.");
    return 0;
  }

  console.log("Configured subscription adapters:");
  for (const adapter of diagnostics) {
    const status = adapter.commandFound ? "command-found" : "command-missing";
    console.log(
      `- ${adapter.name}: command=${adapter.command} format=${adapter.outputFormat} status=${status}`
    );
  }
  console.log("");
  console.log("Use `collab adapters doctor` to validate runnable health.");

  return 0;
}

export async function testAdapterCommand(
  name: string,
  repoPathArg?: string
): Promise<number> {
  const repoPath = resolve(repoPathArg ?? process.cwd());
  const { config } = await loadConfig({
    cwd: repoPath,
    cli: {}
  });

  const registry = new AdapterRegistry(config);
  let adapter: SubscriptionAdapterConfig;
  try {
    adapter = registry.get(name);
  } catch {
    const names = registry.list().map((item) => item.name);
    throw new Error(
      names.length > 0
        ? `Unknown subscription adapter: ${name}. Available: ${names.join(", ")}`
        : `Unknown subscription adapter: ${name}. No adapters are configured.`
    );
  }
  const argsOverride = adapter.testArgs ?? adapter.args ?? [];

  try {
    const result = await runSubprocessAdapter({
      adapter,
      model: `${adapter.name}-cli-test`,
      argsOverride,
      cwd: repoPath,
      input: {
        role: "architect",
        task: "Adapter CLI smoke test",
        round: 1,
        boardSummary: "Adapter test invocation from `collab adapters test`",
        priorMessages: [],
        timeoutMs: ADAPTER_CLI_TIMEOUT_MS
      }
    });

    console.log(
      `Adapter test passed: ${adapter.name} (format=${adapter.outputFormat ?? "sections"})`
    );
    console.log("");
    console.log(result.text);
    return 0;
  } catch (error) {
    const message = formatAdapterError(error);
    console.error(`Adapter test failed: ${name}: ${message}`);
    return 1;
  }
}

export async function adaptersDoctorCommand(repoPathArg?: string): Promise<number> {
  const repoPath = resolve(repoPathArg ?? process.cwd());
  const { config } = await loadConfig({
    cwd: repoPath,
    cli: {}
  });

  const registry = new AdapterRegistry(config);
  const diagnostics = await registry.diagnostics();

  if (diagnostics.length === 0) {
    console.log("No subscription adapters configured.");
    return 0;
  }

  let hasFailures = false;
  console.log("Adapter diagnostics:");

  for (const diagnostic of diagnostics) {
    const adapter = registry.get(diagnostic.name);
    const health = await runHealthCheck(adapter, repoPath);
    if (!diagnostic.commandFound || health.status === "fail") {
      hasFailures = true;
    }

    const healthText =
      health.status === "pass"
        ? "pass"
        : health.status === "skipped"
          ? "skipped (no healthCheckArgs)"
          : `fail (${health.code}${health.detail ? `: ${health.detail}` : ""})`;

    console.log(
      `- ${adapter.name}: command=${adapter.command} format=${
        adapter.outputFormat ?? "sections"
      } status=${diagnostic.commandFound ? "command-found" : "command-missing"} health=${healthText}`
    );
  }

  if (hasFailures) {
    console.log("");
    console.log("Some adapters are unhealthy. Use `collab adapters test <name>` for details.");
    return 1;
  }

  return 0;
}

export async function adaptersInitCommand(
  preset: "tri-subscription",
  repoPathArg?: string
): Promise<number> {
  const repoPath = resolve(repoPathArg ?? process.cwd());
  const scriptsBase = "scripts/collab-adapters";
  await scaffoldPresetScripts(repoPath, scriptsBase);
  const snippet = renderTriSubscriptionPreset(scriptsBase);
  const outputPath = join(repoPath, ".collab.adapters.tri-subscription.json");

  try {
    await writeFile(outputPath, `${snippet}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    console.log(`Wrote adapter preset snippet: ${outputPath}`);
    console.log(
      `Scaffolded adapter templates under ${join(repoPath, scriptsBase)}. Replace template commands with real provider CLI wrappers before production use.`
    );
    console.log("Merge this snippet into your .collab.json.");
    return 0;
  } catch (error) {
    const typed = error as NodeJS.ErrnoException;
    const riskyWrite =
      typed.code === "EEXIST" ||
      typed.code === "EACCES" ||
      typed.code === "EPERM" ||
      typed.code === "EROFS";
    if (!riskyWrite) {
      throw error;
    }

    console.log(
      "Could not safely write preset file. Printing tri-subscription snippet to stdout:"
    );
    console.log("");
    console.log(snippet);
    return 0;
  }
}

function parseAdapterGlobalArgs(args: string[]): AdapterGlobalArgs {
  const rest: string[] = [];
  let repoPath: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--repo") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--repo requires a value");
      }
      repoPath = value;
      i += 1;
      continue;
    }
    rest.push(arg);
  }

  return {
    repoPath,
    rest
  };
}

function parseInitArgs(args: string[]): { preset: "tri-subscription" } {
  let preset: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--preset") {
      preset = args[i + 1];
      i += 1;
      continue;
    }

    throw new Error(
      `Unknown option: ${arg}. Usage: collab adapters init --preset tri-subscription`
    );
  }

  if (!preset) {
    throw new Error("Usage: collab adapters init --preset tri-subscription");
  }

  if (preset !== "tri-subscription") {
    throw new Error(`Unknown preset: ${preset}. Supported: tri-subscription`);
  }

  return {
    preset
  };
}

async function scaffoldPresetScripts(repoPath: string, scriptsBase: string): Promise<void> {
  const targetDir = join(repoPath, scriptsBase);
  await mkdir(targetDir, { recursive: true });

  await copyBundledScript(
    "json-adapter-template.mjs",
    join(targetDir, "json-adapter-template.mjs")
  );
  await copyBundledScript("health-check.mjs", join(targetDir, "health-check.mjs"));
}

async function copyBundledScript(name: string, targetPath: string): Promise<void> {
  try {
    await access(targetPath);
    return;
  } catch {
    // continue and write
  }

  const sourcePath = await resolveBundledScriptPath(name);
  const content = await readFile(sourcePath, "utf8");
  await writeFile(targetPath, content, {
    encoding: "utf8",
    flag: "wx"
  });
}

async function resolveBundledScriptPath(name: string): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../scripts/adapters", name),
    resolve(here, "../../../scripts/adapters", name)
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  throw new Error(`Unable to locate bundled adapter script: ${name}`);
}

function renderTriSubscriptionPreset(scriptsBase: string): string {
  const adapterScript = `${scriptsBase}/json-adapter-template.mjs`;
  const healthScript = `${scriptsBase}/health-check.mjs`;

  const snippet = {
    subscriptionAdapters: [
      {
        name: "gemini-subscription",
        command: "node",
        args: [adapterScript, "--role", "architect"],
        outputFormat: "json",
        payloadMode: "stdin",
        testArgs: [adapterScript, "--test"],
        healthCheckArgs: [healthScript],
        env: {
          ADAPTER_PROFILE: "architect",
          ADAPTER_PROVIDER: "gemini"
        },
        enabled: true
      },
      {
        name: "codex-subscription",
        command: "node",
        args: [adapterScript, "--role", "implementer"],
        outputFormat: "json",
        payloadMode: "stdin",
        testArgs: [adapterScript, "--test"],
        healthCheckArgs: [healthScript],
        env: {
          ADAPTER_PROFILE: "implementer",
          ADAPTER_PROVIDER: "codex"
        },
        enabled: true
      },
      {
        name: "claude-subscription",
        command: "node",
        args: [adapterScript, "--role", "reviewer"],
        outputFormat: "json",
        payloadMode: "stdin",
        testArgs: [adapterScript, "--test"],
        healthCheckArgs: [healthScript],
        env: {
          ADAPTER_PROFILE: "reviewer",
          ADAPTER_PROVIDER: "claude"
        },
        enabled: true
      }
    ],
    roles: {
      architect: {
        provider: "adapter",
        adapter: "gemini-subscription",
        model: "gemini-3.1-pro-subscription"
      },
      implementer: {
        provider: "adapter",
        adapter: "codex-subscription",
        model: "gpt-5-codex-subscription"
      },
      reviewer: {
        provider: "adapter",
        adapter: "claude-subscription",
        model: "claude-opus-4.6-subscription"
      },
      arbiter: {
        provider: "adapter",
        adapter: "claude-subscription",
        model: "claude-opus-4.6-subscription"
      }
    },
    team: {
      mode: "auto",
      roleStrategy: "strengths_first",
      debateRounds: 3
    },
    quality: {
      requireEvidence: true,
      rejectUnknownFileRefs: true
    }
  };

  return JSON.stringify(snippet, null, 2);
}

function printAdaptersUsage(): void {
  console.log("Usage: collab adapters <subcommand> [--repo <path>]");
  console.log("Subcommands:");
  console.log("  list");
  console.log("  test <name>");
  console.log("  doctor");
  console.log("  init --preset tri-subscription");
}

async function runHealthCheck(
  adapter: SubscriptionAdapterConfig,
  repoPath: string
): Promise<HealthCheckResult> {
  if (!adapter.healthCheckArgs || adapter.healthCheckArgs.length === 0) {
    return { status: "skipped" };
  }

  const env = buildAdapterEnv(adapter, {
    payloadMode: "stdin",
    extra: {
      COLLAB_ADAPTER_HEALTHCHECK: "1"
    }
  });

  return new Promise<HealthCheckResult>((resolveCheck) => {
    execFile(
      adapter.command,
      adapter.healthCheckArgs ?? [],
      {
        cwd: repoPath,
        timeout: ADAPTER_CLI_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
        env
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolveCheck({ status: "pass", detail: compactOutput(stdout) });
          return;
        }

        const failure = classifyHealthFailure(error, stderr || stdout || error.message);
        resolveCheck({
          status: "fail",
          code: failure.code,
          detail: compactOutput(failure.detail)
        });
      }
    );
  });
}

function classifyHealthFailure(
  error: ExecFileException,
  detail: string
): { code: HealthCheckFailureCode; detail: string } {
  if (error.code === "ENOENT") {
    return {
      code: "not-found",
      detail
    };
  }

  const timeoutLike =
    error.code === "ETIMEDOUT" ||
    error.signal === "SIGTERM" ||
    /timed? out/i.test(error.message);
  if (timeoutLike) {
    return {
      code: "timeout",
      detail
    };
  }

  return {
    code: "non-zero-exit",
    detail
  };
}

function compactOutput(text: string): string {
  const compact = redactSensitiveText(text.trim().replace(/\s+/g, " "));
  if (!compact) {
    return "";
  }

  if (compact.length <= 240) {
    return compact;
  }

  return `${compact.slice(0, 240)}...`;
}

function formatAdapterError(error: unknown): string {
  if (error instanceof AdapterRuntimeError) {
    return redactSensitiveText(error.message);
  }

  return redactSensitiveText(error instanceof Error ? error.message : String(error));
}
