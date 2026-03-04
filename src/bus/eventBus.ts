import { randomUUID } from "node:crypto";
import { writeText } from "../utils/fs.js";
import { redactSensitiveText } from "../safety/redaction.js";
import type { AgentRole, BusEvent } from "../types/index.js";

export class EventBus {
  private readonly events: BusEvent[] = [];

  constructor(private readonly sessionId: string) {}

  emit(event: Omit<BusEvent, "id" | "ts" | "sessionId">): BusEvent {
    const finalEvent: BusEvent = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      sessionId: this.sessionId,
      ...event,
      content: redactSensitiveText(event.content)
    };

    this.events.push(finalEvent);
    return finalEvent;
  }

  list(): BusEvent[] {
    return [...this.events];
  }

  toNdjson(): string {
    return this.events.map((event) => JSON.stringify(event)).join("\n");
  }

  async save(path: string): Promise<void> {
    await writeText(path, `${this.toNdjson()}\n`);
  }

  summarizeBoard(maxChars = 2500): string {
    const lines = this.events
      .slice(-16)
      .map((event) => `round=${event.round} role=${event.role} type=${event.type}\n${event.content}`)
      .join("\n---\n");

    if (lines.length <= maxChars) {
      return lines;
    }

    return lines.slice(lines.length - maxChars);
  }
}

export function systemEvent(
  bus: EventBus,
  round: number,
  content: string,
  role: AgentRole = "arbiter"
): BusEvent {
  return bus.emit({
    round,
    role,
    type: "system",
    content
  });
}
