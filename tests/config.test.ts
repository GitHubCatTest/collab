import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

async function withIsolatedHome<T>(fn: () => Promise<T>): Promise<T> {
  const oldHome = process.env.HOME;
  const isolatedHome = await mkdtemp(join(tmpdir(), "collab-config-home-"));
  process.env.HOME = isolatedHome;

  try {
    return await fn();
  } finally {
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
  }
}

async function writeRepoConfig(config: unknown): Promise<string> {
  const repoPath = await mkdtemp(join(tmpdir(), "collab-config-repo-"));
  await writeFile(join(repoPath, ".collab.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return repoPath;
}

test("loadConfig rejects unsupported adapter payloadMode", async () => {
  await withIsolatedHome(async () => {
    const repoPath = await writeRepoConfig({
      subscriptionAdapters: [
        {
          name: "fixture",
          command: "node",
          payloadMode: "pipe"
        }
      ]
    });

    await assert.rejects(
      () => loadConfig({ cwd: repoPath, cli: {} }),
      /payloadMode must be "stdin" or "env"/
    );
  });
});

test("loadConfig rejects invalid adapter passEnv keys", async () => {
  await withIsolatedHome(async () => {
    const repoPath = await writeRepoConfig({
      subscriptionAdapters: [
        {
          name: "fixture",
          command: "node",
          passEnv: ["bad-key"]
        }
      ]
    });

    await assert.rejects(
      () => loadConfig({ cwd: repoPath, cli: {} }),
      /passEnv contains invalid env key/
    );
  });
});

test("loadConfig rejects non-string adapter env values", async () => {
  await withIsolatedHome(async () => {
    const repoPath = await writeRepoConfig({
      subscriptionAdapters: [
        {
          name: "fixture",
          command: "node",
          env: {
            ADAPTER_PROVIDER: "gemini",
            RETRIES: 3
          }
        }
      ]
    });

    await assert.rejects(
      () => loadConfig({ cwd: repoPath, cli: {} }),
      /env\.RETRIES must be a string/
    );
  });
});

test("loadConfig rejects duplicate adapter names", async () => {
  await withIsolatedHome(async () => {
    const repoPath = await writeRepoConfig({
      subscriptionAdapters: [
        {
          name: "fixture",
          command: "node"
        },
        {
          name: "fixture",
          command: "node"
        }
      ]
    });

    await assert.rejects(
      () => loadConfig({ cwd: repoPath, cli: {} }),
      /Duplicate subscription adapter name/
    );
  });
});
