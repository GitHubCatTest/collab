import { spawn } from "node:child_process";
import type {
  ProviderMessage,
  ProviderName,
  ProviderSubscriptionRuntimeConfig
} from "../providers/types.js";
import { redactSensitiveText } from "../safety/redaction.js";

const MAX_STDIO_CHARS = 1024 * 1024;

export type SubscriptionAdapterErrorCode =
  | "not-found"
  | "timeout"
  | "non-zero-exit"
  | "invalid-output";

export class SubscriptionAdapterError extends Error {
  readonly code: SubscriptionAdapterErrorCode;

  constructor(code: SubscriptionAdapterErrorCode, message: string) {
    super(message);
    this.name = "SubscriptionAdapterError";
    this.code = code;
  }
}

export interface SubscriptionAdapterInvocation {
  provider: ProviderName;
  model: string;
  messages: ProviderMessage[];
  maxOutputTokens: number;
  adapter: ProviderSubscriptionRuntimeConfig;
}

export interface SubscriptionAdapterResult {
  content: string;
  tokens?: {
    input: number;
    output: number;
  };
}

export async function runSubscriptionAdapter(
  invocation: SubscriptionAdapterInvocation
): Promise<SubscriptionAdapterResult> {
  const payload = JSON.stringify({
    provider: invocation.provider,
    model: invocation.model,
    messages: invocation.messages,
    max_output_tokens: invocation.maxOutputTokens
  });

  const stdout = await executeAdapterProcess({
    command: invocation.adapter.command,
    args: invocation.adapter.args,
    timeoutMs: invocation.adapter.timeoutMs,
    passEnv: invocation.adapter.passEnv,
    payload
  });

  return parseAdapterOutput(stdout);
}

async function executeAdapterProcess(args: {
  command: string;
  args: string[];
  timeoutMs: number;
  passEnv?: string[];
  payload: string;
}): Promise<string> {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const child = spawn(args.command, args.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: buildAdapterEnv(args.passEnv)
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 1500);
    }, args.timeoutMs);

    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      fn();
    };

    child.on("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        finish(() => {
          reject(
            new SubscriptionAdapterError(
              "not-found",
              `Adapter command not found: ${formatCommand(args.command)}`
            )
          );
        });
        return;
      }

      finish(() => {
        reject(
          new SubscriptionAdapterError(
            "non-zero-exit",
            `Adapter failed to start: ${
              error instanceof Error ? error.message : String(error)
            } (${formatCommand(args.command)})`
          )
        );
      });
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_STDIO_CHARS) {
        stdout = stdout.slice(0, MAX_STDIO_CHARS);
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_STDIO_CHARS) {
        stderr = stderr.slice(0, MAX_STDIO_CHARS);
      }
    });

    child.on("close", (code) => {
      const stderrPreview = compactProcessOutput(stderr);

      if (timedOut) {
        finish(() => {
          reject(
            new SubscriptionAdapterError(
              "timeout",
              `Adapter timed out: ${formatCommand(args.command)}${
                stderrPreview ? `; stderr: ${stderrPreview}` : ""
              }`
            )
          );
        });
        return;
      }

      if (code !== 0) {
        finish(() => {
          reject(
            new SubscriptionAdapterError(
              "non-zero-exit",
              `Adapter exited non-zero (code=${code ?? "unknown"}): ${formatCommand(args.command)}${
                stderrPreview ? `; stderr: ${stderrPreview}` : ""
              }`
            )
          );
        });
        return;
      }

      finish(() => {
        resolve(stdout);
      });
    });

    child.stdin.write(args.payload);
    child.stdin.end();
  });
}

function parseAdapterOutput(stdout: string): SubscriptionAdapterResult {
  const raw = stdout.trim();
  if (!raw) {
    throw new SubscriptionAdapterError("invalid-output", "Adapter returned empty output");
  }

  const parsed = tryParseJson(raw);
  if (!isRecord(parsed)) {
    return { content: raw };
  }

  if (typeof parsed.content !== "string") {
    throw new SubscriptionAdapterError(
      "invalid-output",
      "Adapter JSON output must include a string \"content\" field"
    );
  }

  const tokens = parseTokenUsage(parsed.tokens);

  return {
    content: parsed.content.trim() || "",
    ...(tokens ? { tokens } : {})
  };
}

function parseTokenUsage(
  value: unknown
):
  | {
      input: number;
      output: number;
    }
  | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const input = value.input;
  const output = value.output;

  if (!isFiniteNonNegativeNumber(input) || !isFiniteNonNegativeNumber(output)) {
    return undefined;
  }

  return {
    input,
    output
  };
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function compactProcessOutput(value: string): string {
  const normalized = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= 320) {
    return normalized;
  }

  return `${normalized.slice(0, 320)}...`;
}

function formatCommand(command: string): string {
  return command;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildAdapterEnv(passEnv?: string[]): NodeJS.ProcessEnv {
  const baseKeys = [
    "PATH",
    "HOME",
    "USER",
    "USERPROFILE",
    "SHELL",
    "TERM",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "COLORTERM",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME"
  ];

  const env: NodeJS.ProcessEnv = {};
  const allowed = new Set<string>([...baseKeys, ...(passEnv ?? [])]);

  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}
