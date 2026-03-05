import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSubscriptionAdapter, SubscriptionAdapterError } from "../src/adapters/subscription.js";
import { loadConfigFromEnv, type CollabMcpConfig } from "../src/config.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { createProviders } from "../src/providers/factory.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { SubscriptionProvider } from "../src/providers/subscription.js";

async function writeScript(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "collab-subscription-provider-"));
  const scriptPath = join(dir, "adapter.mjs");
  await writeFile(scriptPath, source, "utf8");
  return scriptPath;
}

test("runSubscriptionAdapter sends protocol payload and parses JSON output", async () => {
  const scriptPath = await writeScript(`
import { readFileSync } from "node:fs";
const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
if (payload.provider !== "openai") {
  process.stderr.write("unexpected provider");
  process.exit(2);
}
if (payload.model !== "gpt-test") {
  process.stderr.write("unexpected model");
  process.exit(2);
}
if (payload.max_output_tokens !== 77) {
  process.stderr.write("unexpected max_output_tokens");
  process.exit(2);
}
if (!Array.isArray(payload.messages) || payload.messages.length !== 1) {
  process.stderr.write("unexpected messages");
  process.exit(2);
}
process.stdout.write(JSON.stringify({
  content: "json-ok",
  tokens: {
    input: 12,
    output: 34
  }
}));
`);

  const result = await runSubscriptionAdapter({
    provider: "openai",
    model: "gpt-test",
    messages: [{ role: "user", content: "hello" }],
    maxOutputTokens: 77,
    adapter: {
      command: process.execPath,
      args: [scriptPath],
      timeoutMs: 5000
    }
  });

  assert.equal(result.content, "json-ok");
  assert.deepEqual(result.tokens, { input: 12, output: 34 });
});

test("runSubscriptionAdapter accepts plain text output", async () => {
  const scriptPath = await writeScript(`
process.stdout.write("plain-output");
`);

  const result = await runSubscriptionAdapter({
    provider: "anthropic",
    model: "claude-test",
    messages: [{ role: "user", content: "hello" }],
    maxOutputTokens: 32,
    adapter: {
      command: process.execPath,
      args: [scriptPath],
      timeoutMs: 5000
    }
  });

  assert.equal(result.content, "plain-output");
  assert.equal(result.tokens, undefined);
});

test("runSubscriptionAdapter includes stderr on non-zero exit", async () => {
  const scriptPath = await writeScript(`
process.stderr.write("adapter exploded");
process.exit(7);
`);

  await assert.rejects(
    () =>
      runSubscriptionAdapter({
        provider: "google",
        model: "gemini-test",
        messages: [{ role: "user", content: "hello" }],
        maxOutputTokens: 32,
        adapter: {
          command: process.execPath,
          args: [scriptPath],
          timeoutMs: 5000
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof SubscriptionAdapterError);
      assert.equal(error.code, "non-zero-exit");
      assert.match(error.message, /adapter exploded/);
      return true;
    }
  );
});

test("runSubscriptionAdapter times out long-running adapters", async () => {
  const scriptPath = await writeScript(`
setTimeout(() => {
  process.stdout.write("late");
}, 5_000);
`);

  await assert.rejects(
    () =>
      runSubscriptionAdapter({
        provider: "openai",
        model: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
        maxOutputTokens: 32,
        adapter: {
          command: process.execPath,
          args: [scriptPath],
          timeoutMs: 50
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof SubscriptionAdapterError);
      assert.equal(error.code, "timeout");
      return true;
    }
  );
});

test("runSubscriptionAdapter does not leak arbitrary parent env by default", async () => {
  const scriptPath = await writeScript(`
if (process.env.SECRET_SHOULD_NOT_LEAK) {
  process.stderr.write("secret leaked");
  process.exit(9);
}
process.stdout.write("ok");
`);

  const original = process.env.SECRET_SHOULD_NOT_LEAK;
  process.env.SECRET_SHOULD_NOT_LEAK = "super-secret";

  try {
    const result = await runSubscriptionAdapter({
      provider: "google",
      model: "gemini-test",
      messages: [{ role: "user", content: "hello" }],
      maxOutputTokens: 32,
      adapter: {
        command: process.execPath,
        args: [scriptPath],
        timeoutMs: 5000
      }
    });

    assert.equal(result.content, "ok");
  } finally {
    if (original === undefined) {
      delete process.env.SECRET_SHOULD_NOT_LEAK;
    } else {
      process.env.SECRET_SHOULD_NOT_LEAK = original;
    }
  }
});

test("runSubscriptionAdapter passes allowlisted env keys when configured", async () => {
  const scriptPath = await writeScript(`
if (process.env.CUSTOM_ALLOWED_ENV !== "allowed-value") {
  process.stderr.write("missing pass-through env");
  process.exit(9);
}
process.stdout.write("ok");
`);

  const original = process.env.CUSTOM_ALLOWED_ENV;
  process.env.CUSTOM_ALLOWED_ENV = "allowed-value";

  try {
    const result = await runSubscriptionAdapter({
      provider: "openai",
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
      maxOutputTokens: 32,
      adapter: {
        command: process.execPath,
        args: [scriptPath],
        timeoutMs: 5000,
        passEnv: ["CUSTOM_ALLOWED_ENV"]
      }
    });

    assert.equal(result.content, "ok");
  } finally {
    if (original === undefined) {
      delete process.env.CUSTOM_ALLOWED_ENV;
    } else {
      process.env.CUSTOM_ALLOWED_ENV = original;
    }
  }
});

test("loadConfigFromEnv parses provider transport and adapter fields", () => {
  const config = loadConfigFromEnv({
    COLLAB_OPENAI_TRANSPORT: "subscription",
    COLLAB_OPENAI_ADAPTER_COMMAND: process.execPath,
    COLLAB_OPENAI_ADAPTER_ARGS: '["--version"]',
    COLLAB_OPENAI_ADAPTER_TIMEOUT_MS: "1800",
    COLLAB_OPENAI_ADAPTER_PASS_ENV: '["HOME","PATH","BAD-KEY"]',
    COLLAB_GOOGLE_TRANSPORT: "invalid-mode",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "anthropic-key",
    GOOGLE_API_KEY: "google-key"
  });

  assert.equal(config.providers.openai.transport, "subscription");
  assert.equal(config.providers.openai.subscription?.command, process.execPath);
  assert.deepEqual(config.providers.openai.subscription?.args, ["--version"]);
  assert.equal(config.providers.openai.subscription?.timeoutMs, 1800);
  assert.deepEqual(config.providers.openai.subscription?.passEnv, ["HOME", "PATH"]);
  assert.equal(config.providers.openai.available, true);
  assert.equal(config.providers.google.transport, "api");
});

test("createProviders returns subscription provider when transport=subscription", () => {
  const config = loadConfigFromEnv({
    COLLAB_OPENAI_TRANSPORT: "subscription",
    COLLAB_OPENAI_ADAPTER_COMMAND: process.execPath,
    COLLAB_OPENAI_ADAPTER_ARGS: "[]",
    ANTHROPIC_API_KEY: "anthropic-key"
  });

  const providers = createProviders(config, ["openai", "anthropic"]);
  const openai = providers.find((provider) => provider.provider === "openai");
  const anthropic = providers.find((provider) => provider.provider === "anthropic");

  assert.ok(openai instanceof SubscriptionProvider);
  assert.ok(anthropic instanceof AnthropicProvider);
});

test("createProviders falls back to API provider when subscription adapter config is missing", () => {
  const config: CollabMcpConfig = {
    defaultLayers: 2,
    maxLayers: 4,
    timeoutMs: 60000,
    maxOutputTokens: 1200,
    defaultSynthesizer: "anthropic",
    providers: {
      openai: {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKeyEnv: "OPENAI_API_KEY",
        baseUrl: "https://api.openai.com/v1/responses",
        timeoutMs: 60000,
        maxOutputTokens: 1200,
        transport: "subscription",
        available: true
      },
      anthropic: {
        provider: "anthropic",
        model: "claude-3-5-haiku-latest",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        baseUrl: "https://api.anthropic.com/v1/messages",
        timeoutMs: 60000,
        maxOutputTokens: 1200,
        transport: "api",
        available: true
      },
      google: {
        provider: "google",
        model: "gemini-2.0-flash",
        apiKeyEnv: "GOOGLE_API_KEY",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        timeoutMs: 60000,
        maxOutputTokens: 1200,
        transport: "api",
        available: false
      }
    }
  };

  const providers = createProviders(config, ["openai", "anthropic"]);
  const openai = providers.find((provider) => provider.provider === "openai");

  assert.ok(openai instanceof OpenAIProvider);
});
