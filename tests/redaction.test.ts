import test from "node:test";
import assert from "node:assert/strict";
import { redactSensitiveText } from "../src/safety/redaction.js";

test("redacts known token patterns", () => {
  const syntheticApiKey = `api_key=${"A".repeat(24)}`;
  const input = [
    `authorization: Bearer ${"B".repeat(32)}`,
    syntheticApiKey,
    `x-api-key: ${"C".repeat(24)}`
  ].join("\n");

  const output = redactSensitiveText(input);

  assert.equal(output.includes("BBBB"), false);
  assert.equal(output.includes("CCCC"), false);
  assert.match(output, /REDACTED/i);
});
