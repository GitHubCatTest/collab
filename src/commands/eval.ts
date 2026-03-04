import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCandidatePatch, validateUnifiedPatch } from "../patches/synthesizer.js";
import { runVerification } from "../verification/runner.js";
import { runCommand } from "./run.js";
import type { Proposal } from "../types/index.js";

export type EvalSuite = "smoke" | "regression";

interface EvalRunOptions {
  suite: EvalSuite;
  repoPath: string;
  json: boolean;
}

interface EvalCheckResult {
  name: string;
  passed: boolean;
  details: string;
  durationMs: number;
}

interface EvalRunResult {
  suite: EvalSuite;
  passed: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  checks: EvalCheckResult[];
}

export async function evalCommand(args: string[]): Promise<number> {
  if (args[0] !== "run") {
    throw new Error("Usage: collab eval run --suite smoke|regression [--repo <path>] [--json]");
  }

  const options = parseEvalRunArgs(args.slice(1));
  const result = await runEvalSuite(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.passed ? 0 : 1;
  }

  printEvalSummary(result);
  return result.passed ? 0 : 1;
}

export function parseEvalRunArgs(args: string[]): EvalRunOptions {
  let suite: EvalSuite = "smoke";
  let repoPath = process.cwd();
  let json = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--suite") {
      const value = requireValue(args[++i], arg);
      if (value !== "smoke" && value !== "regression") {
        throw new Error(`Invalid --suite value: ${value}`);
      }
      suite = value;
      continue;
    }

    if (arg === "--repo") {
      repoPath = resolve(requireValue(args[++i], arg));
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    throw new Error(`Unknown eval option: ${arg}`);
  }

  return {
    suite,
    repoPath,
    json
  };
}

async function runEvalSuite(options: EvalRunOptions): Promise<EvalRunResult> {
  const started = Date.now();
  const checks: EvalCheckResult[] = [];

  checks.push(await runCheck("patch_synthesis_fallback", async () => {
    const proposal: Proposal = {
      id: "eval-1",
      round: 1,
      authorRole: "implementer",
      summary: "Create fallback patch",
      diffPlan: "Add generated documentation file",
      risks: [],
      tests: [],
      evidence: [],
      rawText: "SUMMARY:\nno patch provided"
    };

    const patch = buildCandidatePatch(proposal);
    const valid = validateUnifiedPatch(patch.patch);
    if (!valid.valid) {
      throw new Error(valid.reason ?? "patch invalid");
    }

    if (patch.source !== "fallback") {
      throw new Error(`expected fallback patch source, got ${patch.source}`);
    }

    return "fallback patch was generated and validated";
  }));

  checks.push(await runCheck("verification_profile_none", async () => {
    const result = await runVerification({
      repoPath: options.repoPath,
      profile: "none"
    });

    if (!result.passed || result.commandResults.length !== 0) {
      throw new Error("verification none profile should pass without running commands");
    }

    return result.summary;
  }));

  if (options.suite === "regression") {
    checks.push(await runCheck("run_mode_plan_with_local_adapter", async () => {
      const tempRepo = await mkdtemp(join(tmpdir(), "collab-eval-repo-"));
      await writeFile(join(tempRepo, "README.md"), "# eval\n", "utf8");
      await writeFile(
        join(tempRepo, "package.json"),
        JSON.stringify({ name: "collab-eval-temp", version: "1.0.0" }, null, 2),
        "utf8"
      );

      const adapterScript = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../scripts/adapters/example-adapter.mjs"
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
          budgetUsd: 1,
          timeoutSec: 120
        },
        execution: {
          mode: "plan",
          maxRevisionLoops: 0,
          requireApplyConfirmation: true
        },
        verification: {
          profile: "none",
          commands: []
        },
        telemetry: {
          enabled: false
        },
        outputDir: ".collab/eval"
      };

      await writeFile(join(tempRepo, ".collab.json"), JSON.stringify(config, null, 2), "utf8");

      const code = await runSilenced(() =>
        runCommand("plan a tiny refactor", {
          repoPath: tempRepo,
          mode: "plan",
          verify: "none",
          maxRevisionLoops: 0,
          outDir: ".collab/eval",
          json: true
        })
      );

      if (code !== 0) {
        throw new Error(`runCommand returned non-zero code: ${code}`);
      }

      return "plan mode run succeeded via local adapter";
    }));
  }

  const finished = Date.now();
  const passed = checks.every((check) => check.passed);

  return {
    suite: options.suite,
    passed,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    checks
  };
}

async function runCheck(
  name: string,
  fn: () => Promise<string>
): Promise<EvalCheckResult> {
  const started = Date.now();
  try {
    const details = await fn();
    return {
      name,
      passed: true,
      details,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      name,
      passed: false,
      details: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started
    };
  }
}

function printEvalSummary(result: EvalRunResult): void {
  console.log("Collab Eval Summary");
  console.log(`- Suite: ${result.suite}`);
  console.log(`- Passed: ${result.passed}`);
  console.log(`- Duration: ${result.durationMs}ms`);
  for (const check of result.checks) {
    console.log(`- [${check.passed ? "PASS" : "FAIL"}] ${check.name}: ${check.details}`);
  }
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

async function runSilenced<T>(fn: () => Promise<T>): Promise<T> {
  const oldLog = console.log;
  const oldError = console.error;
  console.log = () => undefined;
  console.error = () => undefined;

  try {
    return await fn();
  } finally {
    console.log = oldLog;
    console.error = oldError;
  }
}
