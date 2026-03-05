import { join } from "node:path";
import type {
  CandidatePatch,
  OrchestrationResult,
  SessionArtifacts,
  VerificationResult
} from "../types/index.js";
import { redactSensitiveText, redactUnknown } from "../safety/redaction.js";
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

  const redactedEvents = redactUnknown(payload.orchestration.events) as OrchestrationResult["events"];
  const redactedSummary = redactUnknown(payload.orchestration.summary);
  const redactedPatch = redactSensitiveText(payload.candidatePatch.patch);

  await Promise.all([
    writeText(finalPath, renderFinalReport(payload)),
    writeText(diffPath, redactedPatch),
    writeText(
      logPath,
      redactedEvents.map((event) => JSON.stringify(event)).join("\n") + "\n"
    ),
    writeText(summaryPath, JSON.stringify(redactedSummary, null, 2) + "\n")
  ]);

  return {
    finalPath,
    diffPath,
    logPath,
    summaryPath
  };
}

function renderFinalReport(payload: ArtifactPayload): string {
  const redactedPayload = redactUnknown(payload) as ArtifactPayload;
  const winner = redactedPayload.orchestration.winningProposal;
  const summary = redactedPayload.orchestration.summary;
  const verificationLines =
    redactedPayload.verification.commandResults.length > 0
      ? redactedPayload.verification.commandResults.map((result) =>
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
    `- Patch source: ${redactedPayload.candidatePatch.source}`,
    `- Verification: ${redactedPayload.verification.summary}`,
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
    redactedPayload.orchestration.arbiterDecision.rationale,
    "",
    "## Alternatives",
    ...(redactedPayload.orchestration.arbiterDecision.alternatives.length > 0
      ? redactedPayload.orchestration.arbiterDecision.alternatives.map((id) => `- ${id}`)
      : ["- None"]),
    "",
    "## Verification Commands",
    ...verificationLines
  ].join("\n");
}
