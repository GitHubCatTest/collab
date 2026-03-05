import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface CliRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[]): Promise<CliRunResult> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("close", (code) => {
      resolvePromise({
        code,
        stdout,
        stderr
      });
    });
  });
}

test("doctor rejects unexpected trailing args", async () => {
  const repoPath = await mkdtemp(resolve(tmpdir(), "collab-doctor-cli-"));
  const result = await runCli(["doctor", "--repo", repoPath, "extra"]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Usage: collab doctor \[--repo <path>\]/);
});
