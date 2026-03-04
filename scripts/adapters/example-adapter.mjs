#!/usr/bin/env node

/**
 * Example collab subprocess adapter.
 *
 * Input:
 *   process.env.COLLAB_ADAPTER_PAYLOAD (JSON)
 * Output:
 *   plain text with sections expected by collab parser:
 *   SUMMARY / DIFF_PLAN / RISKS / TESTS / EVIDENCE
 */

function main() {
  const payloadRaw = process.env.COLLAB_ADAPTER_PAYLOAD;
  if (!payloadRaw) {
    console.error("COLLAB_ADAPTER_PAYLOAD is missing");
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(payloadRaw);
  } catch (error) {
    console.error(`Invalid COLLAB_ADAPTER_PAYLOAD JSON: ${String(error)}`);
    process.exit(1);
  }

  const task = String(payload.task ?? "unknown task");
  const round = Number(payload.round ?? 0);
  const role = String(payload.role ?? "unknown");

  const output = [
    "SUMMARY:",
    `[example-adapter] ${role} recommendation for: ${task}`,
    "",
    "DIFF_PLAN:",
    `- Create focused changes for round ${round}`,
    "- Keep edits incremental and test-first",
    "- Avoid unrelated file churn",
    "",
    "RISKS:",
    "- Adapter output may be generic unless connected to a real provider CLI",
    "",
    "TESTS:",
    "- Run unit tests for changed modules",
    "- Run integration tests for workflow paths",
    "",
    "EVIDENCE:",
    "- Based on payload task and round metadata"
  ].join("\n");

  process.stdout.write(`${output}\n`);
}

main();
