import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ExecutionMode, RunCliOptions, VerificationProfile } from "../types/index.js";
import { runCommand } from "./run.js";

interface ChatOptions {
  repoPath?: string;
  mode: ExecutionMode;
  verify?: VerificationProfile;
  maxRevisionLoops?: number;
  autoYes?: boolean;
}

export async function chatCommand(args: string[]): Promise<number> {
  const options = parseChatOptions(args);
  const rl = readline.createInterface({ input, output });

  console.log("collab chat mode");
  console.log("Type a task and press Enter. Type /exit to quit.");

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const line = (await rl.question("collab> ")).trim();
      if (!line) {
        continue;
      }

      if (line === "/exit" || line === "exit" || line === "quit") {
        break;
      }

      const runOptions: RunCliOptions = {
        repoPath: options.repoPath,
        mode: options.mode,
        verify: options.verify,
        maxRevisionLoops: options.maxRevisionLoops,
        autoYes: options.autoYes
      };

      try {
        // eslint-disable-next-line no-await-in-loop
        await runCommand(line, runOptions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Task failed: ${message}`);
      }
    }
  } finally {
    rl.close();
  }

  return 0;
}

function parseChatOptions(args: string[]): ChatOptions {
  const options: ChatOptions = {
    mode: "plan"
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--repo") {
      options.repoPath = requireValue(args[++i], arg);
      continue;
    }

    if (arg === "--mode") {
      const value = requireValue(args[++i], arg);
      if (value !== "plan" && value !== "patch" && value !== "apply") {
        throw new Error(`Invalid --mode value: ${value}`);
      }
      options.mode = value;
      continue;
    }

    if (arg === "--verify") {
      const value = requireValue(args[++i], arg);
      if (value !== "none" && value !== "basic" && value !== "strict") {
        throw new Error(`Invalid --verify value: ${value}`);
      }
      options.verify = value;
      continue;
    }

    if (arg === "--max-revisions") {
      const value = Number(requireValue(args[++i], arg));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("--max-revisions requires a number >= 0");
      }
      options.maxRevisionLoops = value;
      continue;
    }

    if (arg === "--yes") {
      options.autoYes = true;
      continue;
    }

    throw new Error(`Unknown chat option: ${arg}`);
  }

  return options;
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}
