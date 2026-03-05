#!/usr/bin/env node
import { readFileSync } from "node:fs";

/**
 * JSON adapter template for collab-mcp subscription transport.
 * Reads stdin payload and emits { content, tokens? }.
 */

function main() {
  const payload = readPayload();

  const summary = [
    `Subscription adapter template response for ${payload.provider}`,
    payload.model ? `Model: ${payload.model}` : "",
    "",
    "Messages:",
    ...payload.messages.map((message) => `[${message.role}] ${compact(message.content)}`)
  ]
    .filter(Boolean)
    .join("\n");

  process.stdout.write(
    `${JSON.stringify({ content: summary, tokens: { input: 0, output: Math.ceil(summary.length / 4) } })}\n`
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

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
