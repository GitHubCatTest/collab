import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOrchestration } from "../src/orchestrator/roundEngine.js";
import type { CollabConfig } from "../src/types/index.js";

async function createFixtureRepo(): Promise<{ repoPath: string; adapterPath: string }> {
  const repoPath = await mkdtemp(join(tmpdir(), "collab-orchestrator-test-"));
  await mkdir(join(repoPath, "src"), { recursive: true });
  await writeFile(join(repoPath, "src", "index.ts"), "export const ready = true;\n", "utf8");

  const adapterPath = join(repoPath, "adapter-fixture.mjs");
  await writeFile(
    adapterPath,
    `#!/usr/bin/env node
import { readFileSync } from "node:fs";

function readPayload() {
  try {
    const stdin = readFileSync(0, "utf8").trim();
    if (stdin) return stdin;
  } catch {
    // ignore and fall back to env mode
  }
  return process.env.COLLAB_ADAPTER_PAYLOAD ?? "{}";
}

const payload = JSON.parse(readPayload() || "{}");
const role = String(payload.role ?? "architect");
const round = Number(payload.round ?? 0);

if (round === 0) {
  const strengths = {
    architect: "implementation code patch build ship deliver",
    implementer: "review verify test risk security regression",
    reviewer: "architecture design plan system interface structure"
  };

  process.stdout.write([
    "SUMMARY:",
    strengths[role] ?? "unknown",
    "",
    "DIFF_PLAN:",
    "- role negotiation",
    "",
    "RISKS:",
    "- none",
    "",
    "TESTS:",
    "- none",
    "",
    "EVIDENCE:"
  ].join("\\n") + "\\n");
  process.exit(0);
}

if (role === "architect") {
  process.stdout.write([
    "SUMMARY:",
    "Implement rate limiter with secure validate rollback design",
    "",
    "DIFF_PLAN:",
    "- incremental module file focused change",
    "- add minimal guard in request path",
    "",
    "RISKS:",
    "- secret handling regression",
    "",
    "TESTS:",
    "- unit test request throttling",
    "- integration test auth flow",
    "",
    "EVIDENCE:"
  ].join("\\n") + "\\n");
  process.exit(0);
}

if (role === "implementer") {
  process.stdout.write([
    "SUMMARY:",
    "Small follow-up implementation",
    "",
    "DIFF_PLAN:",
    "- full rewrite complete overhaul from scratch",
    "",
    "RISKS:",
    "- rollout risk",
    "",
    "TESTS:",
    "- unit test",
    "",
    "EVIDENCE:",
    "- src/index.ts"
  ].join("\\n") + "\\n");
  process.exit(0);
}

process.stdout.write([
  "SUMMARY:",
  "Reviewer opinion with medium scope",
  "",
  "DIFF_PLAN:",
  "- review and note possible changes",
  "",
  "RISKS:",
  "- none",
  "",
  "TESTS:",
  "- integration",
  "",
  "EVIDENCE:"
].join("\\n") + "\\n");
`,
    "utf8"
  );

  return { repoPath, adapterPath };
}

function buildConfig(adapterPath: string): CollabConfig {
  return {
    roles: {
      architect: { provider: "adapter", model: "fixture", adapter: "fixture" },
      implementer: { provider: "adapter", model: "fixture", adapter: "fixture" },
      reviewer: { provider: "adapter", model: "fixture", adapter: "fixture" },
      arbiter: { provider: "adapter", model: "fixture", adapter: "fixture" }
    },
    providers: {
      openrouter: { apiKeyEnv: "OPENROUTER_API_KEY" },
      anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
      google: { apiKeyEnv: "GOOGLE_API_KEY" },
      openai: { apiKeyEnv: "OPENAI_API_KEY" }
    },
    subscriptionAdapters: [
      {
        name: "fixture",
        command: process.execPath,
        args: [adapterPath],
        outputFormat: "sections",
        enabled: true
      }
    ],
    limits: {
      maxRounds: 1,
      budgetUsd: 5,
      timeoutSec: 120
    },
    execution: {
      mode: "plan",
      maxRevisionLoops: 0,
      requireApplyConfirmation: true,
      parallelPeerRoles: true,
      allowFallbackPatch: false
    },
    team: {
      mode: "auto",
      roleStrategy: "strengths_first",
      debateRounds: 1
    },
    quality: {
      requireEvidence: false,
      rejectUnknownFileRefs: false
    },
    verification: {
      profile: "none",
      commands: []
    },
    telemetry: {
      enabled: false
    },
    outputDir: ".collab/test-orchestrator"
  };
}

test("quality gate overrides winner when evidence is required", async () => {
  const { repoPath, adapterPath } = await createFixtureRepo();
  const config = buildConfig(adapterPath);
  config.quality.requireEvidence = true;

  const result = await runOrchestration({
    task: "implement rate limiter",
    repoPath,
    config,
    outputDir: join(repoPath, ".collab", "session")
  });

  assert.equal(result.winningProposal.authorRole, "implementer");

  const qualityEvent = result.events.find((event) => event.type === "quality_gate");
  assert.ok(qualityEvent);
  assert.match(qualityEvent.content, /status=overridden/);
  assert.match(qualityEvent.content, /requireEvidence enforced\./);
});

test("auto strengths mapping remaps team roles in negotiation", async () => {
  const { repoPath, adapterPath } = await createFixtureRepo();
  const config = buildConfig(adapterPath);

  const result = await runOrchestration({
    task: "implement rate limiter",
    repoPath,
    config,
    outputDir: join(repoPath, ".collab", "session")
  });

  const negotiationEvent = result.events.find(
    (event) =>
      event.type === "role_negotiation" && event.role === "arbiter" && /mapping selected by strengths/.test(event.content)
  );

  assert.ok(negotiationEvent);
  assert.match(
    negotiationEvent.content,
    /architect<=reviewer, implementer<=architect, reviewer<=implementer/
  );
});
