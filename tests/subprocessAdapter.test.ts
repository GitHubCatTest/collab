import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAdapterEnv,
  runSubprocessAdapter
} from "../src/adapters/subprocessAdapter.js";
import type { SubscriptionAdapterConfig } from "../src/types/index.js";

function adapterFixture(overrides: Partial<SubscriptionAdapterConfig> = {}): SubscriptionAdapterConfig {
  return {
    name: "fixture",
    command: "node",
    ...overrides
  };
}

test("buildAdapterEnv uses strict env by default and does not leak payload in stdin mode", () => {
  const original = process.env.COLLAB_TEST_SECRET;
  process.env.COLLAB_TEST_SECRET = "super-secret";

  try {
    const env = buildAdapterEnv(adapterFixture(), {
      payloadMode: "stdin",
      payload: '{"task":"test"}'
    });

    assert.equal(env.COLLAB_ADAPTER_PAYLOAD_MODE, "stdin");
    assert.equal("COLLAB_ADAPTER_PAYLOAD" in env, false);
    assert.equal("COLLAB_TEST_SECRET" in env, false);
  } finally {
    if (original === undefined) {
      delete process.env.COLLAB_TEST_SECRET;
    } else {
      process.env.COLLAB_TEST_SECRET = original;
    }
  }
});

test("buildAdapterEnv supports explicit env payload mode", () => {
  const env = buildAdapterEnv(adapterFixture(), {
    payloadMode: "env",
    payload: '{"task":"test"}'
  });

  assert.equal(env.COLLAB_ADAPTER_PAYLOAD_MODE, "env");
  assert.equal(env.COLLAB_ADAPTER_PAYLOAD, '{"task":"test"}');
});

test("runSubprocessAdapter delivers payload over stdin by default", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "collab-adapter-stdin-"));
  const scriptPath = join(workdir, "stdin-adapter.mjs");

  await writeFile(
    scriptPath,
    `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const raw = readFileSync(0, "utf8").trim();
const payload = JSON.parse(raw || process.env.COLLAB_ADAPTER_PAYLOAD || "{}");
process.stdout.write(JSON.stringify({
  summary: "stdin-ok",
  diffPlan: "round=" + String(payload.round ?? "missing"),
  risks: [],
  tests: [],
  evidence: []
}));
`,
    "utf8"
  );

  const result = await runSubprocessAdapter({
    adapter: {
      name: "stdin-fixture",
      command: process.execPath,
      args: [scriptPath],
      outputFormat: "json"
    },
    model: "fixture-model",
    input: {
      role: "architect",
      task: "adapter stdin test",
      round: 3,
      boardSummary: "",
      priorMessages: [],
      timeoutMs: 5000
    }
  });

  assert.match(result.text, /SUMMARY:/);
  assert.match(result.text, /stdin-ok/);
  assert.match(result.text, /round=3/);
});
