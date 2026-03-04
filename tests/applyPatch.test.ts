import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import {
  applyPatch,
  applyPatchSafely,
  checkPatchApplies
} from "../src/git/applyPatch.js";

function exec(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

test("git apply check/apply works for valid patch", async () => {
  const repo = await mkdtemp(join(tmpdir(), "collab-apply-"));
  await exec("git", ["init"], repo);
  await writeFile(join(repo, "a.txt"), "old\n", "utf8");

  const patch = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new"
  ].join("\n");
  const patchPath = join(repo, "change.patch");
  await writeFile(patchPath, `${patch}\n`, "utf8");

  const check = await checkPatchApplies(repo, patchPath);
  assert.equal(check.success, true);

  const applied = await applyPatch(repo, patchPath);
  assert.equal(applied.success, true);

  const content = await readFile(join(repo, "a.txt"), "utf8");
  assert.equal(content, "new\n");
});

test("applyPatchSafely supports check-only mode", async () => {
  const repo = await mkdtemp(join(tmpdir(), "collab-apply-safe-"));
  await exec("git", ["init"], repo);
  await writeFile(join(repo, "b.txt"), "one\n", "utf8");

  const patch = [
    "diff --git a/b.txt b/b.txt",
    "--- a/b.txt",
    "+++ b/b.txt",
    "@@ -1 +1 @@",
    "-one",
    "+two"
  ].join("\n");
  const patchPath = join(repo, "safe.patch");
  await writeFile(patchPath, `${patch}\n`, "utf8");

  const result = await applyPatchSafely({
    repoPath: repo,
    patchPath,
    checkOnly: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.checked, true);
  assert.equal(result.applied, false);
});
