import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "../src/commands/run.js";

async function setupAdapterRepo(
  options: { allowFallbackPatch?: boolean } = {}
): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "collab-run-test-"));
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src", "index.ts"), "export const ok = true;\n", "utf8");
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify(
      {
        name: "collab-run-test",
        private: true,
        version: "1.0.0",
        scripts: {
          lint: "echo lint-ok",
          test: "echo test-ok",
          build: "echo build-ok"
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const adapterScript = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../scripts/adapters/example-adapter.mjs"
  );

  const config = {
    roles: {
      architect: { provider: "adapter", model: "local-eval", adapter: "example" },
      implementer: { provider: "adapter", model: "local-eval", adapter: "example" },
      reviewer: { provider: "adapter", model: "local-eval", adapter: "example" },
      arbiter: { provider: "adapter", model: "local-eval", adapter: "example" }
    },
    providers: {
      openrouter: { apiKeyEnv: "OPENROUTER_API_KEY" },
      anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
      google: { apiKeyEnv: "GOOGLE_API_KEY" },
      openai: { apiKeyEnv: "OPENAI_API_KEY" }
    },
    subscriptionAdapters: [
      {
        name: "example",
        command: process.execPath,
        args: [adapterScript],
        enabled: true
      }
    ],
    limits: {
      maxRounds: 1,
      budgetUsd: 3,
      timeoutSec: 120
    },
    execution: {
      mode: "patch",
      maxRevisionLoops: 0,
      requireApplyConfirmation: true,
      parallelPeerRoles: true,
      allowFallbackPatch: options.allowFallbackPatch ?? true
    },
    verification: {
      profile: "strict",
      commands: []
    },
    telemetry: {
      enabled: false
    },
    outputDir: ".collab/test-out"
  };

  await writeFile(join(repo, ".collab.json"), JSON.stringify(config, null, 2) + "\n", "utf8");

  return repo;
}

async function latestAttemptDir(repo: string): Promise<string> {
  const base = join(repo, ".collab", "test-out");
  const timestamps = await readdir(base);
  assert.ok(timestamps.length >= 1);
  const latest = timestamps.sort().at(-1) as string;
  return join(base, latest, "attempt-1");
}

async function withMutedConsole<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};

  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("runCommand succeeds in plan mode with local adapters", async () => {
  const repo = await setupAdapterRepo();

  const code = await withMutedConsole(() =>
    runCommand("plan feature rollout", {
      repoPath: repo,
      mode: "plan",
      verify: "none",
      maxRounds: 1,
      maxRevisionLoops: 0,
      outDir: ".collab/test-out"
    })
  );

  assert.equal(code, 0);

  const attemptDir = await latestAttemptDir(repo);
  const summaryRaw = await readFile(join(attemptDir, "summary.json"), "utf8");
  const summary = JSON.parse(summaryRaw) as {
    mode: string;
    verificationPassed: boolean;
  };

  assert.equal(summary.mode, "plan");
  assert.equal(summary.verificationPassed, true);
});

test("runCommand patch mode verifies in temp workspace", async () => {
  const repo = await setupAdapterRepo();

  const code = await withMutedConsole(() =>
    runCommand("patch module", {
      repoPath: repo,
      mode: "patch",
      verify: "strict",
      maxRounds: 1,
      maxRevisionLoops: 0,
      outDir: ".collab/test-out"
    })
  );

  assert.equal(code, 0);

  const attemptDir = await latestAttemptDir(repo);
  const files = await readdir(attemptDir);
  assert.ok(files.includes("final.md"));
  assert.ok(files.includes("patch.diff"));
  assert.ok(files.includes("session.ndjson"));
  assert.ok(files.includes("summary.json"));

  const summaryRaw = await readFile(join(attemptDir, "summary.json"), "utf8");
  const summary = JSON.parse(summaryRaw) as {
    mode: string;
    verificationPassed: boolean;
    patchSource?: string;
  };

  assert.equal(summary.mode, "patch");
  assert.equal(summary.verificationPassed, true);
  assert.ok(summary.patchSource === "model" || summary.patchSource === "fallback");
});

test("runCommand patch mode blocks fallback patch without opt-in", async () => {
  const repo = await setupAdapterRepo({ allowFallbackPatch: false });

  const code = await withMutedConsole(() =>
    runCommand("patch module", {
      repoPath: repo,
      mode: "patch",
      verify: "strict",
      maxRounds: 1,
      maxRevisionLoops: 0,
      outDir: ".collab/test-out"
    })
  );

  assert.equal(code, 1);

  const attemptDir = await latestAttemptDir(repo);
  const summaryRaw = await readFile(join(attemptDir, "summary.json"), "utf8");
  const summary = JSON.parse(summaryRaw) as {
    mode: string;
    verificationPassed: boolean;
    patchSource?: string;
  };

  assert.equal(summary.mode, "patch");
  assert.equal(summary.verificationPassed, false);
  assert.equal(summary.patchSource, "fallback");
});
