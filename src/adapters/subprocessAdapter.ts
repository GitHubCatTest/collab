import { spawn } from "node:child_process";
import type {
  BusEvent,
  GenerateInput,
  GenerateResult,
  SubscriptionAdapterConfig
} from "../types/index.js";
import { redactSensitiveText } from "../safety/redaction.js";

const MAX_PRIOR_MESSAGES = 24;
const MAX_MESSAGE_CONTENT_CHARS = 1200;
const MAX_STDIO_CHARS = 10 * 1024 * 1024;
const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SHELL",
  "COMSPEC",
  "SystemRoot",
  "PATHEXT",
  "TERM",
  "LANG",
  "LC_ALL"
];

export type AdapterRuntimeErrorCode =
  | "not-found"
  | "timeout"
  | "parse-failed"
  | "non-zero-exit";

export class AdapterRuntimeError extends Error {
  readonly code: AdapterRuntimeErrorCode;
  readonly adapterName: string;

  constructor(code: AdapterRuntimeErrorCode, adapterName: string, detail: string) {
    super(`[adapter/${code}] ${detail}`);
    this.name = "AdapterRuntimeError";
    this.code = code;
    this.adapterName = adapterName;
  }
}

export interface AdapterInvocation {
  adapter: SubscriptionAdapterConfig;
  model: string;
  input: GenerateInput;
  argsOverride?: string[];
  cwd?: string;
}

export async function runSubprocessAdapter(
  invocation: AdapterInvocation
): Promise<GenerateResult> {
  const startMs = Date.now();
  const outputFormat = invocation.adapter.outputFormat ?? "sections";
  const payloadMode = invocation.adapter.payloadMode ?? "stdin";

  const payload = JSON.stringify({
    model: invocation.model,
    role: invocation.input.role,
    round: invocation.input.round,
    task: invocation.input.task,
    boardSummary: invocation.input.boardSummary,
    priorMessages: boundPriorMessages(invocation.input.priorMessages)
  });

  const args = invocation.argsOverride ?? invocation.adapter.args ?? [];
  const env = buildAdapterEnv(invocation.adapter, {
    payloadMode,
    payload
  });
  const stdout = await executeAdapterProcess({
    adapterName: invocation.adapter.name,
    command: invocation.adapter.command,
    args,
    cwd: invocation.cwd,
    timeoutMs: invocation.input.timeoutMs,
    env,
    payload,
    payloadMode
  });

  const text =
    outputFormat === "json"
      ? parseJsonOutputToSections(stdout, invocation.adapter.name)
      : stdout.trim() || "SUMMARY:\nAdapter returned empty output";

  const latencyMs = Date.now() - startMs;

  return {
    text: text || "SUMMARY:\nAdapter returned empty output",
    provider: "adapter",
    model: invocation.model,
    latencyMs,
    estimatedCostUsd: 0
  };
}

export function buildAdapterEnv(
  adapter: SubscriptionAdapterConfig,
  options: {
    payloadMode?: "stdin" | "env";
    payload?: string;
    extra?: Record<string, string>;
  } = {}
): Record<string, string> {
  const env: Record<string, string> = {};
  const payloadMode = options.payloadMode ?? adapter.payloadMode ?? "stdin";

  if (adapter.inheritEnv) {
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") {
        env[key] = value;
      }
    }
  } else {
    const allowlist = new Set([
      ...SAFE_ENV_KEYS,
      ...(adapter.passEnv ?? [])
    ]);
    for (const key of allowlist) {
      const value = process.env[key];
      if (typeof value === "string") {
        env[key] = value;
      }
    }
  }

  for (const [key, value] of Object.entries(adapter.env ?? {})) {
    env[key] = value;
  }

  if (options.extra) {
    for (const [key, value] of Object.entries(options.extra)) {
      env[key] = value;
    }
  }

  env.COLLAB_ADAPTER_PAYLOAD_MODE = payloadMode;
  if (payloadMode === "env" && options.payload) {
    env.COLLAB_ADAPTER_PAYLOAD = options.payload;
  }

  return env;
}

function boundPriorMessages(messages: BusEvent[]): BusEvent[] {
  const bounded = messages.slice(-MAX_PRIOR_MESSAGES);
  return bounded.map((message) => ({
    ...message,
    content: truncate(message.content, MAX_MESSAGE_CONTENT_CHARS),
    refs: message.refs?.slice(0, 8)
  }));
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...`;
}

async function executeAdapterProcess(args: {
  adapterName: string;
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  env: Record<string, string>;
  payload: string;
  payloadMode: "stdin" | "env";
}): Promise<string> {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const child = spawn(args.command, args.args, {
      cwd: args.cwd,
      env: args.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const done = (fn: () => void): void => {
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

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 1500);
    }, args.timeoutMs);

    child.on("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        done(() =>
          reject(
            new AdapterRuntimeError(
              "not-found",
              args.adapterName,
              `Adapter "${args.adapterName}" command not found: ${formatCommand(
                args.command,
                args.args
              )}`
            )
          )
        );
        return;
      }

      done(() =>
        reject(
          new AdapterRuntimeError(
            "non-zero-exit",
            args.adapterName,
            redactSensitiveText(
              `Adapter "${args.adapterName}" failed before execution: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          )
        )
      );
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
      if (timedOut) {
        done(() =>
          reject(
            new AdapterRuntimeError(
              "timeout",
              args.adapterName,
              `Adapter "${args.adapterName}" timed out while running: ${formatCommand(
                args.command,
                args.args
              )}`
            )
          )
        );
        return;
      }

      if (code !== 0) {
        const detail = compactProcessOutput(stderr, stdout, `exit code ${code ?? "unknown"}`);
        done(() =>
          reject(
            new AdapterRuntimeError(
              "non-zero-exit",
              args.adapterName,
              redactSensitiveText(
                `Adapter "${args.adapterName}" exited non-zero (code=${
                  code ?? "unknown"
                }) for: ${formatCommand(args.command, args.args)}${
                  detail ? `; output: ${detail}` : ""
                }`
              )
            )
          )
        );
        return;
      }

      done(() => resolve(stdout));
    });

    if (args.payloadMode === "stdin") {
      child.stdin.write(args.payload);
    }
    child.stdin.end();
  });
}

function compactProcessOutput(stderr: string, stdout: string, fallback: string): string {
  const text = redactSensitiveText((stderr || stdout || fallback).trim());
  if (!text) {
    return "";
  }

  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 320) {
    return singleLine;
  }

  return `${singleLine.slice(0, 320)}...`;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ").trim();
}

interface AdapterJsonSections {
  summary: string;
  diffPlan: string;
  risks: string[];
  tests: string[];
  evidence: string[];
}

function parseJsonOutputToSections(stdout: string, adapterName: string): string {
  const raw = stdout.trim();
  if (!raw) {
    throw new AdapterRuntimeError(
      "parse-failed",
      adapterName,
      `Adapter "${adapterName}" returned empty JSON output`
    );
  }

  let parsed = tryParseJson(raw);
  if (!parsed) {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      parsed = tryParseJson(raw.slice(firstBrace, lastBrace + 1));
    }
  }

  if (!parsed) {
    throw new AdapterRuntimeError(
      "parse-failed",
      adapterName,
      `Adapter "${adapterName}" returned invalid JSON output`
    );
  }

  if (!isRecord(parsed)) {
    throw new AdapterRuntimeError(
      "parse-failed",
      adapterName,
      `Adapter "${adapterName}" JSON output must be an object`
    );
  }

  const sectionsSource = isRecord(parsed.sections) ? parsed.sections : parsed;
  const sections: AdapterJsonSections = {
    summary: normalizeText(readSectionValue(sectionsSource, ["summary", "SUMMARY"])),
    diffPlan: normalizeText(
      readSectionValue(sectionsSource, ["diffPlan", "diff_plan", "DIFF_PLAN"])
    ),
    risks: normalizeList(readSectionValue(sectionsSource, ["risks", "RISKS"])),
    tests: normalizeList(readSectionValue(sectionsSource, ["tests", "TESTS"])),
    evidence: normalizeList(readSectionValue(sectionsSource, ["evidence", "EVIDENCE"]))
  };

  if (!sections.summary && !sections.diffPlan) {
    throw new AdapterRuntimeError(
      "parse-failed",
      adapterName,
      `Adapter "${adapterName}" JSON output is missing summary/diffPlan fields`
    );
  }

  return renderSectionsText({
    summary: sections.summary || "No summary provided",
    diffPlan: sections.diffPlan || "No diff plan provided",
    risks: sections.risks,
    tests: sections.tests,
    evidence: sections.evidence
  });
}

function tryParseJson(input: string): unknown | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function readSectionValue(source: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (name in source) {
      return source[name];
    }
  }

  return undefined;
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry).trim()))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry).trim()))
      .filter(Boolean)
      .slice(0, 12);
  }

  if (typeof value === "string") {
    return value
      .split("\n")
      .map((entry) => entry.replace(/^[-*\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  return [];
}

function renderSectionsText(sections: AdapterJsonSections): string {
  const lines = [
    "SUMMARY:",
    sections.summary,
    "",
    "DIFF_PLAN:",
    sections.diffPlan,
    "",
    "RISKS:",
    ...sections.risks.map((item) => `- ${item}`),
    "",
    "TESTS:",
    ...sections.tests.map((item) => `- ${item}`),
    "",
    "EVIDENCE:",
    ...sections.evidence.map((item) => `- ${item}`)
  ];

  return lines.join("\n").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
