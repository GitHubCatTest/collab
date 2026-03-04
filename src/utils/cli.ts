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
      options.repoPath = readOptionValue(args, ++i, arg);
      continue;
    }

    if (arg === "--max-rounds") {
      options.maxRounds = parsePositiveNumber(readOptionValue(args, ++i, arg), arg);
      continue;
    }

    if (arg === "--budget-usd") {
      options.budgetUsd = parsePositiveNumber(readOptionValue(args, ++i, arg), arg);
      continue;
    }

    if (arg === "--timeout-sec") {
      options.timeoutSec = parsePositiveNumber(readOptionValue(args, ++i, arg), arg);
      continue;
    }

    if (arg === "--out") {
      options.outDir = readOptionValue(args, ++i, arg);
      continue;
    }

    if (arg === "--mode") {
      const value = readOptionValue(args, ++i, arg);
      if (value !== "plan" && value !== "patch" && value !== "apply") {
        throw new Error(`Invalid --mode value: ${value}`);
      }
      options.mode = value;
      continue;
    }

    if (arg === "--verify") {
      const value = readOptionValue(args, ++i, arg);
      if (value !== "none" && value !== "basic" && value !== "strict") {
        throw new Error(`Invalid --verify value: ${value}`);
      }
      options.verify = value;
      continue;
    }

    if (arg === "--max-revisions") {
      const value = parseNonNegativeNumber(readOptionValue(args, ++i, arg), arg);
      options.maxRevisionLoops = value;
      continue;
    }

    if (arg === "--yes") {
      options.autoYes = true;
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

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function parsePositiveNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a number greater than 0`);
  }

  return parsed;
}

function parseNonNegativeNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a number greater than or equal to 0`);
  }

  return parsed;
}

export function printUsage(): void {
  console.log(`collab - terminal-native heterogeneous multi-model dev agent\n
Usage:
  collab run "<task>" [options]
  collab chat [options]
  collab doctor
  collab adapters list
  collab replay <session.ndjson>

Run options:
  --repo <path>         Repository path (default: current directory)
  --max-rounds <n>      Max debate rounds (default from config)
  --budget-usd <n>      Session budget in USD (default from config)
  --timeout-sec <n>     Session timeout in seconds (default from config)
  --mode <mode>         Execution mode: plan|patch|apply
  --verify <profile>    Verification profile: none|basic|strict
  --max-revisions <n>   Auto-revision attempts when verification fails
  --yes                 Skip apply confirmation prompt
  --out <dir>           Output base directory
  --json                Print machine-readable summary JSON

Chat options:
  --repo <path>         Repository path
  --mode <mode>         Default mode for chat tasks (default: plan)
  --verify <profile>    Verification profile for chat tasks
  --max-revisions <n>   Max revision attempts per task
  --yes                 Skip apply confirmation prompt
`);
}
