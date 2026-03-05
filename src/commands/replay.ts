import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { redactSensitiveText } from "../safety/redaction.js";
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
    .map((line) => safeParseEvent(line))
    .filter((event): event is BusEvent => event !== null);

  if (events.length === 0) {
    console.log("No events found in log file.");
    return 0;
  }

  printReplaySummary(events);

  let currentRound = -1;
  for (const event of events) {
    if (event.round !== currentRound) {
      currentRound = event.round;
    console.log(`\n=== Round ${currentRound} ===`);
    }

    console.log(`[${event.ts}] ${event.role}/${event.type}`);
    console.log(redactSensitiveText(event.content));
  }

  return 0;
}

function safeParseEvent(line: string): BusEvent | null {
  try {
    const event = JSON.parse(line) as BusEvent;
    return {
      ...event,
      content: redactSensitiveText(String(event.content ?? "")),
      refs: Array.isArray(event.refs)
        ? event.refs.map((ref) => redactSensitiveText(ref))
        : undefined
    };
  } catch {
    return null;
  }
}

function printReplaySummary(events: BusEvent[]): void {
  const rounds = [...new Set(events.map((event) => event.round))].sort((a, b) => a - b);
  const byType = countBy(events, (event) => event.type);
  const byRole = countBy(events, (event) => event.role);
  const warningsCount = byType.warning ?? 0;
  const verificationCount = byType.verification ?? 0;
  const totalCostUsd = events.reduce(
    (sum, event) => sum + (event.costUsd ?? 0),
    0
  );

  console.log("Replay Summary");
  console.log(`- Events: ${events.length}`);
  console.log(`- Rounds: ${rounds.join(", ")}`);
  console.log(`- Warnings: ${warningsCount}`);
  console.log(`- Verification events: ${verificationCount}`);
  console.log(`- Estimated cost from events: $${totalCostUsd.toFixed(6)}`);
  console.log("- Event counts by type:");
  for (const [type, count] of Object.entries(byType).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    console.log(`  - ${type}: ${count}`);
  }
  console.log("- Event counts by role:");
  for (const [role, count] of Object.entries(byRole).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    console.log(`  - ${role}: ${count}`);
  }
}

function countBy<T, K extends string>(
  items: T[],
  selector: (item: T) => K
): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const item of items) {
    const key = selector(item);
    out[key] = (out[key] ?? 0) + 1;
  }

  return out;
}
