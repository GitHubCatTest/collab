import { join } from "node:path";
import type { OrchestrationResult, SessionArtifacts } from "../types/index.js";
import { ensureDirectory, writeText } from "../utils/fs.js";

export async function writeArtifacts(
  baseDir: string,
  result: OrchestrationResult
): Promise<SessionArtifacts> {
  await ensureDirectory(baseDir);

  const finalPath = join(baseDir, "final.md");
  const diffPath = join(baseDir, "patch.diff");
  const logPath = join(baseDir, "session.ndjson");
  const summaryPath = join(baseDir, "summary.json");

  await Promise.all([
    writeText(finalPath, renderFinalReport(result)),
    writeText(diffPath, renderPatch(result)),
    writeText(logPath, result.events.map((event) => JSON.stringify(event)).join("\n") + "\n"),
    writeText(summaryPath, JSON.stringify(result.summary, null, 2) + "\n")
  ]);

  return {
    finalPath,
    diffPath,
    logPath,
    summaryPath
  };
}

function renderFinalReport(result: OrchestrationResult): string {
  const winner = result.winningProposal;

  return [
    "# Collab Session Result",
    "",
    `- Session: ${result.summary.sessionId}`,
    `- Task: ${result.summary.task}`,
    `- Rounds completed: ${result.summary.roundsCompleted}`,
    `- Total estimated cost: $${result.summary.totalCostUsd.toFixed(6)}`,
    `- Winner proposal: ${winner.id}`,
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
    result.arbiterDecision.rationale,
    "",
    "## Alternatives",
    ...(result.arbiterDecision.alternatives.length > 0
      ? result.arbiterDecision.alternatives.map((id) => `- ${id}`)
      : ["- None"])
  ].join("\n");
}

function renderPatch(result: OrchestrationResult): string {
  const winner = result.winningProposal;
  const file = "COLLAB_PROPOSED_CHANGES.md";

  const content = [
    "# Proposed Changes",
    "",
    `Proposal ID: ${winner.id}`,
    "",
    "## Summary",
    winner.summary,
    "",
    "## Diff Plan",
    winner.diffPlan,
    "",
    "## Risks",
    ...(winner.risks.length > 0 ? winner.risks : ["None"]),
    "",
    "## Tests",
    ...(winner.tests.length > 0 ? winner.tests : ["None"])
  ];

  const patchLines = [
    `diff --git a/${file} b/${file}`,
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    `+++ b/${file}`,
    `@@ -0,0 +${content.length},${content.length} @@`,
    ...content.map((line) => `+${line}`)
  ];

  return `${patchLines.join("\n")}\n`;
}
