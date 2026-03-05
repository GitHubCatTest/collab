#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 90000;

async function main() {
  const payload = readPayload();
  const bin = process.env.COLLAB_GEMINI_BIN || "gemini";
  const timeoutMs = parseTimeout(process.env.COLLAB_GEMINI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const extraArgs = parseJsonStringArray(process.env.COLLAB_GEMINI_ADAPTER_EXTRA_ARGS);

  const prompt = buildPrompt(payload);
  const args = [
    ...extraArgs,
    ...(payload.model ? ["--model", payload.model] : []),
    "--approval-mode",
    "plan",
    "--output-format",
    "text",
    "--prompt",
    "Use the request in stdin and return only the final answer text."
  ];

  const output = await runCommand({
    command: bin,
    args,
    timeoutMs,
    stdin: prompt
  });

  process.stdout.write(`${JSON.stringify({ content: output })}\n`);
}

function readPayload() {
  const raw = readStdinRaw();
  if (!raw) {
    fail("Subscription adapter payload is required on stdin");
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    fail(`Invalid JSON payload: ${String(error)}`);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("Payload must be a JSON object");
  }

  const messages = Array.isArray(payload.messages)
    ? payload.messages.filter(
        (message) =>
          message &&
          typeof message === "object" &&
          (message.role === "system" || message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string"
      )
    : [];

  if (messages.length === 0) {
    fail("Payload must include non-empty messages array");
  }

  return {
    provider: String(payload.provider || "google"),
    model: typeof payload.model === "string" ? payload.model : "",
    maxOutputTokens: Number.isFinite(payload.max_output_tokens)
      ? Number(payload.max_output_tokens)
      : undefined,
    messages
  };
}

function buildPrompt(payload) {
  const sections = [
    "You are running inside a collab-mcp subscription adapter.",
    `Provider: ${payload.provider}`,
    payload.model ? `Model: ${payload.model}` : "",
    payload.maxOutputTokens
      ? `Max output tokens requested: ${payload.maxOutputTokens}`
      : "",
    "",
    "Conversation:",
    ...payload.messages.map((message) => formatMessage(message))
  ].filter(Boolean);

  return sections.join("\n\n").trim();
}

function formatMessage(message) {
  const role = String(message.role).toUpperCase();
  return `[${role}]\n${String(message.content).trim()}`;
}

async function runCommand({ command, args, timeoutMs, stdin }) {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killTimer;

    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 1500);
    }, timeoutMs);

    const finish = (fn) => {
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
      finish(() => {
        reject(new Error(`Failed to start gemini CLI: ${String(error)}`));
      });
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (timedOut) {
        finish(() => {
          reject(new Error(`gemini CLI timed out after ${timeoutMs}ms`));
        });
        return;
      }

      if (code !== 0) {
        finish(() => {
          reject(
            new Error(
              `gemini CLI failed (code=${code ?? "unknown"}): ${compact(stderr) || compact(stdout) || "no output"}`
            )
          );
        });
        return;
      }

      const content = compact(stdout);
      if (!content) {
        finish(() => {
          reject(new Error(`gemini CLI returned empty output${stderr ? `: ${compact(stderr)}` : ""}`));
        });
        return;
      }

      finish(() => {
        resolve(content);
      });
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

function parseJsonStringArray(raw) {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item) => typeof item === "string").map((item) => item.trim());
  } catch {
    return [];
  }
}

function parseTimeout(raw, fallback) {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value) || value < 100) {
    return fallback;
  }

  return value;
}

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readStdinRaw() {
  try {
    return readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
