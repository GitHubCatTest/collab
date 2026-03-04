import test from "node:test";
import assert from "node:assert/strict";
import { redactSensitiveText } from "../src/safety/redaction.js";

test("redacts known token patterns", () => {
  const input = [
    "authorization: Bearer sk-thisshouldbehidden1234567890123",
    "api_key=sk-abcdefghiABCDEFGHI01234567890123",
    "AIzaSyA12345678901234567890abcd"
  ].join("\n");

  const output = redactSensitiveText(input);

  assert.equal(output.includes("thisshouldbehidden"), false);
  assert.equal(output.includes("APIza"), false);
  assert.match(output, /REDACTED/i);
});
