#!/usr/bin/env node

/**
 * Basic adapter health check helper.
 * Returns exit code 0 when executable and stdin payload (if provided) is valid JSON.
 */

import { readFileSync } from "node:fs";

function main() {
  const raw = readStdinRaw();
  if (raw) {
    try {
      JSON.parse(raw);
    } catch (error) {
      console.error(`Invalid payload during health check: ${String(error)}`);
      process.exit(1);
    }
  }

  process.stdout.write("ok\n");
}

function readStdinRaw() {
  try {
    return readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}

main();
