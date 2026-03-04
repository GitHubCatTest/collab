import { cp, lstat, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeArtifacts } from "../artifacts/writer.js";
import { loadConfig } from "../config.js";
import { applyPatchSafely } from "../git/applyPatch.js";
import { runOrchestration } from "../orchestrator/roundEngine.js";
import {
  buildCandidatePatch,
  validateUnifiedPatch
} from "../patches/synthesizer.js";
import { runVerification } from "../verification/runner.js";
import type {
  CandidatePatch,
  OrchestrationResult,
  RunCliOptions,
  SessionState,
  VerificationResult
} from "../types/index.js";
import { isoTimestampCompact, writeText } from "../utils/fs.js";

interface RunAttempt {
  orchestration: OrchestrationResult;
  patch: CandidatePatch;
  verification: VerificationResult;
  artifacts: {
    finalPath: string;
    diffPath: string;
    logPath: string;
    summaryPath: string;
  };
  outputDir: string;
}

export async function runCommand(task: string, options: RunCliOptions): Promise<number> {
  const repoPath = resolve(options.repoPath ?? process.cwd());
  const { config, loadedFiles } = await loadConfig({
    cwd: repoPath,
    cli: options
  });

  const outputBase = resolveOutputBase(
    repoPath,
    options.outDir ?? config.outputDir ?? ".collab/sessions"
  );
  const runRootDir = join(outputBase, isoTimestampCompact());

  let currentTask = task;
  let finalAttempt: RunAttempt | null = null;

  for (let attempt = 0; attempt <= config.execution.maxRevisionLoops; attempt += 1) {
    const attemptDir = join(runRootDir, `attempt-${attempt + 1}`);

    const orchestration = await runOrchestration({
      task: currentTask,
      repoPath,
      config,
      outputDir: attemptDir
    });

    updateSessionState(orchestration, "planning", "Orchestration completed.");

    const patch = buildCandidatePatch(orchestration.winningProposal);
    updateSessionState(
      orchestration,
      "patching",
      `Candidate patch built (source=${patch.source}).`
    );

    const verification = await verifyCandidatePatch({
      repoPath,
      patch,
      profile: config.verification.profile,
      commandsOverride: config.verification.commands,
      mode: config.execution.mode
    });

    emitVerificationEvent(orchestration, verification.summary);
    updateSessionState(
      orchestration,
      verification.passed ? "completed" : "failed",
      verification.summary
    );

    orchestration.summary.mode = config.execution.mode;
    orchestration.summary.verificationProfile = config.verification.profile;
    orchestration.summary.verificationPassed = verification.passed;
    orchestration.summary.revisionAttempts = attempt;
    orchestration.summary.patchSource = patch.source;

    const artifacts = await writeArtifacts(attemptDir, {
      orchestration,
      candidatePatch: patch,
      verification
    });

    finalAttempt = {
      orchestration,
      patch,
      verification,
      artifacts,
      outputDir: attemptDir
    };

    if (verification.passed || attempt >= config.execution.maxRevisionLoops) {
      break;
    }

    const failureSummary = summarizeVerificationFailure(verification);
    currentTask = [
      task,
      "",
      "Previous attempt failed verification.",
      "Address these issues in the next proposal:",
      failureSummary
    ].join("\n");
  }

  if (!finalAttempt) {
    throw new Error("No orchestration attempts were executed.");
  }

  if (config.execution.mode === "apply" && finalAttempt.verification.passed) {
    updateSessionState(
      finalAttempt.orchestration,
      "ready_to_apply",
      "Patch verified and ready for apply confirmation."
    );

    const confirmed = await confirmApply(
      config.execution.requireApplyConfirmation && !options.autoYes,
      finalAttempt.artifacts.diffPath
    );

      if (confirmed) {
        updateSessionState(finalAttempt.orchestration, "applying", "Applying patch to repository.");
        const applyResult = await applyPatchSafely({
          repoPath,
          patchPath: finalAttempt.artifacts.diffPath
        });

        if (!applyResult.ok) {
          updateSessionState(
            finalAttempt.orchestration,
            "failed",
            `Patch apply failed: ${applyResult.stderr || applyResult.message}`
          );
          finalAttempt.orchestration.summary.verificationPassed = false;
          finalAttempt.orchestration.summary.sessionState = "failed";
        } else {
        const postApplyVerification = await runVerification({
          repoPath,
          profile: config.verification.profile,
          commandsOverride: config.verification.commands
        });

        finalAttempt.verification = postApplyVerification;
        finalAttempt.orchestration.summary.verificationPassed = postApplyVerification.passed;
        finalAttempt.orchestration.summary.sessionState = postApplyVerification.passed
          ? "completed"
          : "failed";

        updateSessionState(
          finalAttempt.orchestration,
          finalAttempt.orchestration.summary.sessionState,
          `Post-apply verification: ${postApplyVerification.summary}`
        );
      }

      await writeArtifacts(finalAttempt.outputDir, {
        orchestration: finalAttempt.orchestration,
        candidatePatch: finalAttempt.patch,
        verification: finalAttempt.verification
      });
    } else {
      finalAttempt.orchestration.summary.sessionState = "ready_to_apply";
      updateSessionState(
        finalAttempt.orchestration,
        "ready_to_apply",
        "Apply skipped by user confirmation gate."
      );
      await writeArtifacts(finalAttempt.outputDir, {
        orchestration: finalAttempt.orchestration,
        candidatePatch: finalAttempt.patch,
        verification: finalAttempt.verification
      });
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          summary: finalAttempt.orchestration.summary,
          artifacts: finalAttempt.artifacts,
          loadedConfigFiles: loadedFiles,
          verification: finalAttempt.verification
        },
        null,
        2
      )
    );
    return finalAttempt.orchestration.summary.verificationPassed ? 0 : 1;
  }

  printHumanSummary(finalAttempt, loadedFiles, runRootDir);

  return finalAttempt.orchestration.summary.verificationPassed ? 0 : 1;
}

function resolveOutputBase(repoPath: string, outDir: string): string {
  if (isAbsolute(outDir)) {
    return outDir;
  }

  return resolve(repoPath, outDir);
}

async function verifyCandidatePatch(args: {
  repoPath: string;
  patch: CandidatePatch;
  profile: "none" | "basic" | "strict";
  commandsOverride: string[];
  mode: "plan" | "patch" | "apply";
}): Promise<VerificationResult> {
  if (args.mode === "plan") {
    return {
      profile: "none",
      passed: true,
      commandResults: [],
      summary: "Plan mode selected; patch verification skipped."
    };
  }

  const patchValidation = validateUnifiedPatch(args.patch.patch);
  if (!patchValidation.valid) {
    return {
      profile: args.profile,
      passed: false,
      commandResults: [],
      summary: `Patch is invalid: ${patchValidation.reason}`
    };
  }

  const workspace = await prepareVerificationWorkspace(args.repoPath);
  try {
    const patchPath = join(workspace, "candidate.patch");
    await writeText(patchPath, args.patch.patch);

    const apply = await applyPatchSafely({
      repoPath: workspace,
      patchPath
    });
    if (!apply.ok) {
      return {
        profile: args.profile,
        passed: false,
        commandResults: [],
        summary: `Patch apply failed in verification workspace: ${
          apply.stderr || apply.stdout
        }`
      };
    }

    return runVerification({
      repoPath: workspace,
      profile: args.profile,
      commandsOverride: args.commandsOverride
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function summarizeVerificationFailure(result: VerificationResult): string {
  if (result.commandResults.length === 0) {
    return result.summary;
  }

  const failed = result.commandResults.find((item) => !item.success);
  if (!failed) {
    return result.summary;
  }

  const errorOutput = [failed.stderr.trim(), failed.stdout.trim()]
    .filter(Boolean)
    .join("\n")
    .slice(0, 800);

  return [
    `Command: ${failed.command}`,
    `Exit code: ${failed.code}`,
    `Output:\n${errorOutput || "(no output)"}`
  ].join("\n\n");
}

function updateSessionState(
  orchestration: OrchestrationResult,
  state: SessionState,
  message: string
): void {
  orchestration.summary.sessionState = state;
  orchestration.events.push({
    id: randomUUID(),
    ts: new Date().toISOString(),
    sessionId: orchestration.sessionId,
    round: orchestration.summary.roundsCompleted,
    role: "arbiter",
    type: "state_transition",
    content: `${state}: ${message}`
  });
}

function emitVerificationEvent(
  orchestration: OrchestrationResult,
  summary: string
): void {
  orchestration.events.push({
    id: randomUUID(),
    ts: new Date().toISOString(),
    sessionId: orchestration.sessionId,
    round: orchestration.summary.roundsCompleted,
    role: "arbiter",
    type: "verification",
    content: summary
  });
}

async function prepareVerificationWorkspace(repoPath: string): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), "collab-verify-"));
  const workspace = join(tempRoot, "workspace");

  await cp(repoPath, workspace, {
    recursive: true,
    filter: (src) => {
      const normalized = src.replace(/\\/g, "/");
      if (normalized.endsWith("/.git") || normalized.includes("/.git/")) {
        return false;
      }
      if (
        normalized.endsWith("/.collab") ||
        normalized.includes("/.collab/")
      ) {
        return false;
      }
      if (
        normalized.endsWith("/node_modules") ||
        normalized.includes("/node_modules/")
      ) {
        return false;
      }

      return true;
    }
  });

  // Reuse existing dependencies without copying huge node_modules trees.
  await maybeLinkNodeModules(repoPath, workspace);

  return workspace;
}

async function maybeLinkNodeModules(
  repoPath: string,
  workspace: string
): Promise<void> {
  try {
    const sourceNodeModules = join(repoPath, "node_modules");
    const stats = await lstat(sourceNodeModules);
    if (!stats.isDirectory() && !stats.isSymbolicLink()) {
      return;
    }

    await symlink(sourceNodeModules, join(workspace, "node_modules"));
  } catch (error) {
    const typed = error as NodeJS.ErrnoException;
    if (typed.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function confirmApply(
  confirmationRequired: boolean,
  patchPath: string
): Promise<boolean> {
  if (!confirmationRequired) {
    return true;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(
      `Apply verified patch to repository? (${patchPath}) [y/N]: `
    );

    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function printHumanSummary(
  attempt: RunAttempt,
  loadedFiles: string[],
  runRootDir: string
): void {
  const summary = attempt.orchestration.summary;
  console.log(`Session complete: ${summary.sessionId}`);
  console.log(`Mode: ${summary.mode}`);
  console.log(`Session state: ${summary.sessionState}`);
  console.log(`Rounds completed: ${summary.roundsCompleted}`);
  console.log(`Revision attempts: ${summary.revisionAttempts}`);
  console.log(`Estimated cost: $${summary.totalCostUsd.toFixed(6)}`);
  console.log(`Winner proposal: ${summary.winnerProposalId}`);
  console.log(`Patch source: ${summary.patchSource ?? "unknown"}`);
  console.log(`Verification: ${attempt.verification.summary}`);
  console.log(`Output root: ${runRootDir}`);
  console.log(`Latest output directory: ${attempt.outputDir}`);
  console.log(`- final report: ${attempt.artifacts.finalPath}`);
  console.log(`- patch diff: ${attempt.artifacts.diffPath}`);
  console.log(`- event log: ${attempt.artifacts.logPath}`);
  console.log(`- summary: ${attempt.artifacts.summaryPath}`);

  if (loadedFiles.length === 0) {
    console.log("Config: using defaults (no config files found)");
  } else {
    console.log(`Config loaded from: ${loadedFiles.join(", ")}`);
  }
}
