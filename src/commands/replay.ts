import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BusEvent } from "../types/index.js";

export async function replayCommand(pathArg: string | undefined): Promise<number> {
  if (!pathArg) {
    throw new Error("Usage: collab replay <session.ndjson>");
  }

  const filePath = resolve(pathArg);
  const raw = await readFile(filePath, "utf8");
  const events = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BusEvent);

  if (events.length === 0) {
    console.log("No events found in log file.");
    return 0;
  }

  let currentRound = -1;
  for (const event of events) {
    if (event.round !== currentRound) {
      currentRound = event.round;
      console.log(`\n=== Round ${currentRound} ===`);
    }

    console.log(`[${event.ts}] ${event.role}/${event.type}`);
    console.log(event.content);
  }

  return 0;
}
