import { join } from "node:path";
import type {
  CandidatePatch,
  OrchestrationResult,
  SessionArtifacts,
  VerificationResult
} from "../types/index.js";
import { ensureDirectory, writeText } from "../utils/fs.js";

interface ArtifactPayload {
  orchestration: OrchestrationResult;
  candidatePatch: CandidatePatch;
  verification: VerificationResult;
}

export async function writeArtifacts(
  baseDir: string,
  payload: ArtifactPayload
): Promise<SessionArtifacts> {
  await ensureDirectory(baseDir);

  const finalPath = join(baseDir, "final.md");
  const diffPath = join(baseDir, "patch.diff");
  const logPath = join(baseDir, "session.ndjson");
  const summaryPath = join(baseDir, "summary.json");

  await Promise.all([
    writeText(finalPath, renderFinalReport(payload)),
    writeText(diffPath, payload.candidatePatch.patch),
    writeText(
      logPath,
      payload.orchestration.events.map((event) => JSON.stringify(event)).join("\n") + "\n"
    ),
    writeText(summaryPath, JSON.stringify(payload.orchestration.summary, null, 2) + "\n")
  ]);

  return {
    finalPath,
    diffPath,
    logPath,
    summaryPath
  };
}

function renderFinalReport(payload: ArtifactPayload): string {
  const winner = payload.orchestration.winningProposal;
  const summary = payload.orchestration.summary;
  const verificationLines =
    payload.verification.commandResults.length > 0
      ? payload.verification.commandResults.map((result) =>
          `- [${result.success ? "PASS" : "FAIL"}] ${result.command} (${result.durationMs}ms)`
        )
      : ["- No verification commands executed"];

  return [
    "# Collab Session Result",
    "",
    `- Session: ${summary.sessionId}`,
    `- Task: ${summary.task}`,
    `- Mode: ${summary.mode}`,
    `- Session state: ${summary.sessionState}`,
    `- Rounds completed: ${summary.roundsCompleted}`,
    `- Total estimated cost: $${summary.totalCostUsd.toFixed(6)}`,
    `- Winner proposal: ${winner.id}`,
    `- Patch source: ${payload.candidatePatch.source}`,
    `- Verification: ${payload.verification.summary}`,
    "",
    "## Winner Summary",
    winner.summary,
    "",
    "## Diff Plan",
    winner.diffPlan,
    "",
    "## Risks",
    ...(winner.risks.length > 0 ? winner.risks.map((risk) => `- ${risk}`) : ["- None"]),
    "",
    "## Tests",
    ...(winner.tests.length > 0 ? winner.tests.map((test) => `- ${test}`) : ["- None"]),
    "",
    "## Arbiter Rationale",
    payload.orchestration.arbiterDecision.rationale,
    "",
    "## Alternatives",
    ...(payload.orchestration.arbiterDecision.alternatives.length > 0
      ? payload.orchestration.arbiterDecision.alternatives.map((id) => `- ${id}`)
      : ["- None"]),
    "",
    "## Verification Commands",
    ...verificationLines
  ].join("\n");
}
