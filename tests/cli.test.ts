import test from "node:test";
import assert from "node:assert/strict";
import { parseRunArgs } from "../src/utils/cli.js";

test("parseRunArgs parses options and task", () => {
  const parsed = parseRunArgs([
    "--repo",
    "./repo",
    "--max-rounds",
    "4",
    "--budget-usd",
    "3.5",
    "--timeout-sec",
    "200",
    "--out",
    "./out",
    "--json",
    "refactor",
    "auth",
    "module"
  ]);

  assert.equal(parsed.task, "refactor auth module");
  assert.equal(parsed.options.repoPath, "./repo");
  assert.equal(parsed.options.maxRounds, 4);
  assert.equal(parsed.options.budgetUsd, 3.5);
  assert.equal(parsed.options.timeoutSec, 200);
  assert.equal(parsed.options.outDir, "./out");
  assert.equal(parsed.options.json, true);
});

test("parseRunArgs rejects unknown options", () => {
  assert.throws(() => parseRunArgs(["--bad-flag", "task"]));
});
