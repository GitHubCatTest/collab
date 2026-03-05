import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

test("gemini CLI adapter transforms payload and returns JSON content", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "collab-gemini-adapter-test-"));
  const fakeGemini = join(tempDir, "fake-gemini.mjs");

  await writeFile(
    fakeGemini,
    `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const stdin = readFileSync(0, "utf8");
if (!args.includes("--approval-mode") || !args.includes("plan")) {
  process.stderr.write("missing approval mode");
  process.exit(11);
}
const modelIndex = args.indexOf("--model");
if (modelIndex < 0 || args[modelIndex + 1] !== "gemini-sub") {
  process.stderr.write("missing model");
  process.exit(12);
}
if (!stdin.includes("[USER]")) {
  process.stderr.write("missing formatted user message");
  process.exit(13);
}
process.stdout.write("gemini-adapter-ok");
`,
    "utf8"
  );
  await chmod(fakeGemini, 0o755);

  const adapterPath = join(process.cwd(), "scripts/adapters/gemini-cli-adapter.mjs");
  const result = await runAdapter(adapterPath, {
    provider: "google",
    model: "gemini-sub",
    max_output_tokens: 512,
    messages: [
      { role: "system", content: "System instructions" },
      { role: "user", content: "Create a plan" }
    ]
  }, {
    COLLAB_GEMINI_BIN: fakeGemini
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.content, "gemini-adapter-ok");
});

test("codex CLI adapter writes/reads output-last-message and returns JSON content", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "collab-codex-adapter-test-"));
  const fakeCodex = join(tempDir, "fake-codex.mjs");

  await writeFile(
    fakeCodex,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] !== "exec") {
  process.stderr.write("expected exec command");
  process.exit(21);
}
const outputIdx = args.indexOf("--output-last-message");
if (outputIdx < 0 || !args[outputIdx + 1]) {
  process.stderr.write("missing output-last-message path");
  process.exit(22);
}
const modelIdx = args.indexOf("--model");
if (modelIdx < 0 || args[modelIdx + 1] !== "codex-sub") {
  process.stderr.write("missing model");
  process.exit(23);
}
const stdin = readFileSync(0, "utf8");
if (!stdin.includes("[SYSTEM]")) {
  process.stderr.write("missing formatted system message");
  process.exit(24);
}
writeFileSync(args[outputIdx + 1], "codex-adapter-ok", "utf8");
process.stdout.write("fallback-stdout");
`,
    "utf8"
  );
  await chmod(fakeCodex, 0o755);

  const adapterPath = join(process.cwd(), "scripts/adapters/codex-cli-adapter.mjs");
  const result = await runAdapter(adapterPath, {
    provider: "openai",
    model: "codex-sub",
    max_output_tokens: 512,
    messages: [
      { role: "system", content: "System instructions" },
      { role: "user", content: "Create a plan" }
    ]
  }, {
    COLLAB_CODEX_BIN: fakeCodex
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.content, "codex-adapter-ok");
});

async function runAdapter(
  adapterPath: string,
  payload: Record<string, unknown>,
  envOverrides: Record<string, string>
): Promise<RunResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [adapterPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...envOverrides
      },
      stdio: ["pipe", "pipe", "pipe"]
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
      reject(error);
    });

    child.on("close", (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
