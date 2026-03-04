#!/usr/bin/env node
import { listAdaptersCommand } from "./commands/adapters.js";
import { chatCommand } from "./commands/chat.js";
import { doctorCommand } from "./commands/doctor.js";
import { replayCommand } from "./commands/replay.js";
import { runCommand } from "./commands/run.js";
import { parseRunArgs, printUsage } from "./utils/cli.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  if (command === "run") {
    const parsed = parseRunArgs(args.slice(1));
    const code = await runCommand(parsed.task, parsed.options);
    process.exit(code);
  }

  if (command === "doctor") {
    const code = await doctorCommand();
    process.exit(code);
  }

  if (command === "chat") {
    const code = await chatCommand(args.slice(1));
    process.exit(code);
  }

  if (command === "adapters") {
    const subcommand = args[1];
    if (subcommand !== "list") {
      throw new Error("Usage: collab adapters list");
    }

    const code = await listAdaptersCommand();
    process.exit(code);
  }

  if (command === "replay") {
    const code = await replayCommand(args[1]);
    process.exit(code);
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
