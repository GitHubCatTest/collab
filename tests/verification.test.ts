import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runVerification } from "../src/verification/runner.js";

test("verification profile none skips commands", async () => {
  const repo = await mkdtemp(join(tmpdir(), "collab-verification-none-"));

  const result = await runVerification({
    repoPath: repo,
    profile: "none"
  });

  assert.equal(result.passed, true);
  assert.equal(result.commandResults.length, 0);
});

test("verification resolves basic and strict commands from package scripts", async () => {
  const repo = await mkdtemp(join(tmpdir(), "collab-verification-scripts-"));
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify(
      {
        name: "tmp-repo",
        version: "1.0.0",
        scripts: {
          lint: "echo lint",
          test: "echo test",
          build: "echo build"
        }
      },
      null,
      2
    )
  );

  const basic = await runVerification({
    repoPath: repo,
    profile: "basic"
  });
  assert.equal(basic.passed, true);
  assert.equal(
    basic.commandResults.map((result) => result.command).join(","),
    "npm run lint,npm test"
  );

  const strict = await runVerification({
    repoPath: repo,
    profile: "strict"
  });
  assert.equal(strict.passed, true);
  assert.equal(
    strict.commandResults.map((result) => result.command).join(","),
    "npm run lint,npm test,npm run build"
  );
});

test("verification uses command override and reports failures", async () => {
  const repo = await mkdtemp(join(tmpdir(), "collab-verification-override-"));

  const result = await runVerification({
    repoPath: repo,
    profile: "basic",
    commandsOverride: ["echo ok", "exit 1"]
  });

  assert.equal(result.passed, false);
  assert.equal(result.commandResults.length, 2);
  assert.equal(result.commandResults[0].success, true);
  assert.equal(result.commandResults[1].success, false);
});
