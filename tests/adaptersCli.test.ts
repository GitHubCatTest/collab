import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { printUsage } from "../src/utils/cli.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface CliRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function captureUsageText(): string {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };

  try {
    printUsage();
  } finally {
    console.log = originalLog;
  }

  return lines.join("\n");
}

function extractDocumentedAdapterSubcommands(): string[] {
  const usage = captureUsageText();
  const lines = usage
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("collab adapters "));

  const subcommands = new Set<string>();

  for (const line of lines) {
    const tail = line.slice("collab adapters ".length).trim();
    if (!tail) {
      continue;
    }

    const firstToken = tail.split(/\s+/)[0];
    for (const token of firstToken.split("|")) {
      const trimmed = token.trim();
      if (!trimmed || trimmed.includes("<") || trimmed.includes("[")) {
        continue;
      }
      if (/^[a-z][a-z0-9-]*$/.test(trimmed)) {
        subcommands.add(trimmed);
      }
    }
  }

  return [...subcommands];
}

async function runCli(
  args: string[],
  envOverrides: Record<string, string> = {}
): Promise<CliRunResult> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...envOverrides
      },
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

test("adapter usage documents at least the list subcommand", () => {
  const subcommands = extractDocumentedAdapterSubcommands();
  assert.ok(subcommands.length >= 1);
  assert.ok(subcommands.includes("list"));
});

test("documented adapter subcommands route through adapter CLI handling", async () => {
  const subcommands = extractDocumentedAdapterSubcommands();
  const isolatedHome = await mkdtemp(join(tmpdir(), "collab-home-"));

  for (const subcommand of subcommands) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runCli(["adapters", subcommand], { HOME: isolatedHome });
    const combinedOutput = [result.stdout, result.stderr].join("\n");

    assert.doesNotMatch(combinedOutput, /Unknown command: adapters/);
    if (subcommand !== "list") {
      assert.doesNotMatch(combinedOutput, /Usage: collab adapters list/);
    }
  }
});

test("adapters rejects unknown subcommand with usage error", async () => {
  const isolatedHome = await mkdtemp(join(tmpdir(), "collab-home-"));
  const result = await runCli(["adapters", "__unknown__"], { HOME: isolatedHome });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Usage: collab adapters/);
});
