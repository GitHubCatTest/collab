import type { RunCliOptions } from "../types/index.js";

export interface ParsedRunArgs {
  task: string;
  options: RunCliOptions;
}

export function parseRunArgs(args: string[]): ParsedRunArgs {
  const options: RunCliOptions = {};
  const taskParts: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--repo") {
      options.repoPath = args[++i];
      continue;
    }

    if (arg === "--max-rounds") {
      options.maxRounds = Number(args[++i]);
      continue;
    }

    if (arg === "--budget-usd") {
      options.budgetUsd = Number(args[++i]);
      continue;
    }

    if (arg === "--timeout-sec") {
      options.timeoutSec = Number(args[++i]);
      continue;
    }

    if (arg === "--out") {
      options.outDir = args[++i];
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    taskParts.push(arg);
  }

  const task = taskParts.join(" ").trim();
  if (!task) {
    throw new Error("Task text is required. Example: collab run \"refactor auth module\"");
  }

  return { task, options };
}

export function printUsage(): void {
  console.log(`collab - terminal-native heterogeneous multi-model dev agent\n
Usage:
  collab run "<task>" [options]
  collab doctor
  collab adapters list
  collab replay <session.ndjson>

Run options:
  --repo <path>         Repository path (default: current directory)
  --max-rounds <n>      Max debate rounds (default from config)
  --budget-usd <n>      Session budget in USD (default from config)
  --timeout-sec <n>     Session timeout in seconds (default from config)
  --out <dir>           Output base directory
  --json                Print machine-readable summary JSON
`);
}
