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
    "--mode",
    "patch",
    "--verify",
    "strict",
    "--max-revisions",
    "2",
    "--yes",
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
  assert.equal(parsed.options.mode, "patch");
  assert.equal(parsed.options.verify, "strict");
  assert.equal(parsed.options.maxRevisionLoops, 2);
  assert.equal(parsed.options.autoYes, true);
  assert.equal(parsed.options.outDir, "./out");
  assert.equal(parsed.options.json, true);
});

test("parseRunArgs rejects unknown options", () => {
  assert.throws(() => parseRunArgs(["--bad-flag", "task"]));
});

test("parseRunArgs rejects invalid mode or verify values", () => {
  assert.throws(() => parseRunArgs(["--mode", "auto", "task"]));
  assert.throws(() => parseRunArgs(["--verify", "full", "task"]));
});

test("parseRunArgs rejects missing option values and invalid numbers", () => {
  assert.throws(() => parseRunArgs(["--repo"]));
  assert.throws(() => parseRunArgs(["--max-rounds", "0", "task"]));
  assert.throws(() => parseRunArgs(["--max-revisions", "-1", "task"]));
});

test("parseRunArgs parses v0.2 team/debate/evidence flags", () => {
  const parsed = parseRunArgs([
    "--team",
    "auto",
    "--debate-rounds",
    "2",
    "--require-evidence",
    "ship",
    "fixes"
  ]);

  assert.equal(parsed.task, "ship fixes");
  assert.equal(parsed.options.teamMode, "auto");
  assert.equal(parsed.options.debateRounds, 2);
  assert.equal(parsed.options.requireEvidence, true);
});

test("parseRunArgs validates v0.2 team flag values", () => {
  assert.throws(() => parseRunArgs(["--team", "hybrid", "task"]));
});
