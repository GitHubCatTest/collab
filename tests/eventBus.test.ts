import test from "node:test";
import assert from "node:assert/strict";
import { EventBus } from "../src/bus/eventBus.js";

test("EventBus stores and summarizes events", () => {
  const bus = new EventBus("session-1");
  bus.emit({
    round: 1,
    role: "architect",
    type: "role_response",
    content: "SUMMARY: design module"
  });

  const events = bus.list();
  assert.equal(events.length, 1);
  assert.equal(events[0].sessionId, "session-1");

  const summary = bus.summarizeBoard();
  assert.match(summary, /architect/);
});
