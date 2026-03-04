import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidatePatch, validateUnifiedPatch } from "../src/patches/synthesizer.js";
import type { Proposal } from "../src/types/index.js";

function makeProposal(rawText: string): Proposal {
  return {
    id: "p1",
    round: 1,
    authorRole: "implementer",
    summary: "summary",
    diffPlan: "diff plan",
    risks: [],
    tests: [],
    evidence: [],
    rawText
  };
}

test("buildCandidatePatch extracts model-provided patch diff", () => {
  const proposal = makeProposal([
    "SUMMARY:",
    "test",
    "",
    "PATCH_DIFF:",
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new"
  ].join("\n"));

  const patch = buildCandidatePatch(proposal);
  assert.equal(patch.source, "model");
  assert.equal(patch.targetFiles[0], "a.txt");
  assert.equal(validateUnifiedPatch(patch.patch).valid, true);
});

test("buildCandidatePatch falls back when patch not supplied", () => {
  const proposal = makeProposal("SUMMARY:\nNo diff content");
  const patch = buildCandidatePatch(proposal);

  assert.equal(patch.source, "fallback");
  assert.equal(validateUnifiedPatch(patch.patch).valid, true);
});
