import test from "node:test";
import assert from "node:assert/strict";
import { decideProposal, scoreProposal } from "../src/arbiter/scorer.js";
import type { Proposal } from "../src/types/index.js";

function proposal(overrides: Partial<Proposal>): Proposal {
  return {
    id: "p1",
    round: 1,
    authorRole: "implementer",
    summary: "Implement rate limiter middleware",
    diffPlan: "Add module files with incremental changes and unit tests",
    risks: ["Race conditions"],
    tests: ["unit test", "integration test"],
    evidence: ["existing architecture constraints"],
    rawText: "SUMMARY: ...",
    ...overrides
  };
}

test("scoreProposal returns weighted score in range", () => {
  const p = proposal({});
  const score = scoreProposal("build rate limiter middleware", p);

  assert.ok(score.weightedTotal >= 0);
  assert.ok(score.weightedTotal <= 5);
  assert.ok(score.alignment >= 0);
  assert.ok(score.alignment <= 5);
});

test("decideProposal picks higher-quality proposal", () => {
  const strong = proposal({ id: "strong" });
  const weak = proposal({
    id: "weak",
    summary: "Rewrite everything fast",
    diffPlan: "complete overhaul rewrite everything",
    risks: [],
    tests: []
  });

  const decision = decideProposal("implement rate limiter module", [weak, strong]);
  assert.equal(decision.winnerId, "strong");
  assert.ok(decision.alternatives.includes("weak"));
});
