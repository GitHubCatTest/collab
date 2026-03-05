import test from "node:test";
import assert from "node:assert/strict";
import { parseStructuredPlan } from "../src/pipeline/parser.js";

test("parseStructuredPlan maps markdown sections to structured JSON", () => {
  const markdown = [
    "## Agreements",
    "- Ship behind a feature flag",
    "- Keep migrations backward compatible",
    "",
    "## Disagreements",
    "- Queue backend: Redis vs SQS; choose SQS for ops simplicity",
    "",
    "## Tech Stack",
    "- API: Node.js + Fastify",
    "- Data: PostgreSQL",
    "",
    "## Implementation Steps",
    "1. Add queue abstraction",
    "2. Implement worker pipeline",
    "3. Add integration tests",
    "",
    "## Risks",
    "- Rollback complexity during partial rollout"
  ].join("\n");

  const parsed = parseStructuredPlan(markdown);

  assert.equal(parsed.fallbackUsed, false);
  assert.deepEqual(parsed.agreements, [
    "Ship behind a feature flag",
    "Keep migrations backward compatible"
  ]);
  assert.deepEqual(parsed.disagreements, [
    "Queue backend: Redis vs SQS; choose SQS for ops simplicity"
  ]);
  assert.deepEqual(parsed.techStack, ["API: Node.js + Fastify", "Data: PostgreSQL"]);
  assert.deepEqual(parsed.implementationSteps, [
    "Add queue abstraction",
    "Implement worker pipeline",
    "Add integration tests"
  ]);
  assert.deepEqual(parsed.risks, ["Rollback complexity during partial rollout"]);
});

test("parseStructuredPlan uses fallback when sections are partial", () => {
  const markdown = [
    "AGREEMENTS:",
    "- Keep scope small for initial release",
    "",
    "IMPLEMENTATION STEPS:",
    "1. Add endpoint guard",
    "2. Add smoke test coverage",
    "",
    "Alternative under discussion: Redis vs in-memory queue.",
    "Main risk is token leakage in logs."
  ].join("\n");

  const parsed = parseStructuredPlan(markdown);

  assert.equal(parsed.fallbackUsed, true);
  assert.deepEqual(parsed.agreements, ["Keep scope small for initial release"]);
  assert.deepEqual(parsed.implementationSteps, [
    "Add endpoint guard",
    "Add smoke test coverage",
    "Alternative under discussion: Redis vs in-memory queue. Main risk is token leakage in logs."
  ]);
  assert.ok(parsed.disagreements.some((item) => /redis vs in-memory queue/i.test(item)));
  assert.ok(parsed.risks.some((item) => /token leakage/i.test(item)));
  assert.ok(parsed.missingSections.length > 0);
});

test("parseStructuredPlan recovers useful output from unstructured markdown", () => {
  const markdown = [
    "Build an API with Node and PostgreSQL.",
    "",
    "- Start with auth contract",
    "- Implement protected endpoints",
    "- Add integration tests",
    "",
    "Risk: rollout can leak tokens if logging is not redacted."
  ].join("\n");

  const parsed = parseStructuredPlan(markdown);

  assert.equal(parsed.fallbackUsed, true);
  assert.ok(parsed.agreements.length >= 1);
  assert.ok(parsed.implementationSteps.length >= 2);
  assert.ok(parsed.techStack.some((item) => /node|postgresql/i.test(item)));
  assert.ok(parsed.risks.some((item) => /risk|token/i.test(item)));
});
