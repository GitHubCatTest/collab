#!/usr/bin/env node
import { readFileSync } from "node:fs";

/**
 * Minimal subscription adapter template for collab-mcp.
 *
 * Input (stdin JSON):
 * {
 *   provider: "openai|anthropic|google",
 *   model: "...",
 *   messages: [{ role, content }],
 *   max_output_tokens: number
 * }
 *
 * Output:
 * - Plain text, or JSON: { content: string, tokens?: { input, output } }
 */

function main() {
  const payload = readPayload();

  const lastUser = [...payload.messages]
    .reverse()
    .find((message) => message.role === "user")?.content;

  const content = [
    `Provider: ${payload.provider}`,
    `Model: ${payload.model || "(default)"}`,
    "",
    "Example adapter response:",
    lastUser || "(no user message found)"
  ].join("\n");

  process.stdout.write(
    `${JSON.stringify({ content, tokens: { input: 0, output: Math.ceil(content.length / 4) } })}\n`
  );
}

function readPayload() {
  const raw = readStdinRaw();
  if (!raw) {
    fail("Expected JSON payload on stdin");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`Invalid JSON payload: ${String(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("Payload must be an object");
  }

  const messages = Array.isArray(parsed.messages)
    ? parsed.messages.filter(
        (message) =>
          message &&
          typeof message === "object" &&
          (message.role === "system" || message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string"
      )
    : [];

  if (messages.length === 0) {
    fail("Payload must contain a non-empty messages array");
  }

  return {
    provider: String(parsed.provider || "unknown"),
    model: typeof parsed.model === "string" ? parsed.model : "",
    messages
  };
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

main();
