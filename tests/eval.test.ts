import test from "node:test";
import assert from "node:assert/strict";
import { evalCommand, parseEvalRunArgs } from "../src/commands/eval.js";

test("parseEvalRunArgs parses suite/repo/json", () => {
  const parsed = parseEvalRunArgs([
    "--suite",
    "regression",
    "--repo",
    "/tmp/demo",
    "--json"
  ]);

  assert.equal(parsed.suite, "regression");
  assert.equal(parsed.repoPath, "/tmp/demo");
  assert.equal(parsed.json, true);
});

test("parseEvalRunArgs validates suite", () => {
  assert.throws(() => parseEvalRunArgs(["--suite", "full"]));
});

test("evalCommand smoke suite completes successfully", async () => {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};

  try {
    const code = await evalCommand(["run", "--suite", "smoke", "--json"]);
    assert.equal(code, 0);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});
