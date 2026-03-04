import { resolve, isAbsolute, join } from "node:path";
import { loadConfig } from "../config.js";
import { writeArtifacts } from "../artifacts/writer.js";
import { runOrchestration } from "../orchestrator/roundEngine.js";
import { isoTimestampCompact } from "../utils/fs.js";
import type { RunCliOptions } from "../types/index.js";

export async function runCommand(task: string, options: RunCliOptions): Promise<number> {
  const repoPath = resolve(options.repoPath ?? process.cwd());
  const { config, loadedFiles } = await loadConfig({
    cwd: repoPath,
    cli: options
  });

  const outputBase = resolveOutputBase(repoPath, options.outDir ?? config.outputDir ?? ".collab/sessions");
  const outputDir = join(outputBase, isoTimestampCompact());

  const result = await runOrchestration({
    task,
    repoPath,
    config,
    outputDir
  });

  const artifacts = await writeArtifacts(outputDir, result);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          summary: result.summary,
          artifacts,
          loadedConfigFiles: loadedFiles
        },
        null,
        2
      )
    );
    return 0;
  }

  console.log(`Session complete: ${result.summary.sessionId}`);
  console.log(`Rounds completed: ${result.summary.roundsCompleted}`);
  console.log(`Estimated cost: $${result.summary.totalCostUsd.toFixed(6)}`);
  console.log(`Winner proposal: ${result.summary.winnerProposalId}`);
  console.log(`Output directory: ${outputDir}`);
  console.log(`- final report: ${artifacts.finalPath}`);
  console.log(`- patch diff: ${artifacts.diffPath}`);
  console.log(`- event log: ${artifacts.logPath}`);
  console.log(`- summary: ${artifacts.summaryPath}`);

  if (loadedFiles.length === 0) {
    console.log("Config: using defaults (no config files found)");
  } else {
    console.log(`Config loaded from: ${loadedFiles.join(", ")}`);
  }

  return 0;
}

function resolveOutputBase(repoPath: string, outDir: string): string {
  if (isAbsolute(outDir)) {
    return outDir;
  }

  return resolve(repoPath, outDir);
}
