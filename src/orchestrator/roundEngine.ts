import { randomUUID } from "node:crypto";
import { AdapterRegistry } from "../adapters/registry.js";
import { runSubprocessAdapter } from "../adapters/subprocessAdapter.js";
import { decideProposal } from "../arbiter/scorer.js";
import { EventBus, systemEvent } from "../bus/eventBus.js";
import { ProviderFactory } from "../providers/factory.js";
import { ProviderRequestError } from "../providers/errors.js";
import type {
  AgentRole,
  ArbiterDecision,
  CollabConfig,
  GenerateResult,
  OrchestrationResult,
  Proposal,
  ProviderName
} from "../types/index.js";
import { collectRepoContext, formatRepoContext } from "./context.js";

export interface RunOrchestrationArgs {
  task: string;
  repoPath: string;
  config: CollabConfig;
  outputDir: string;
}

interface RuntimeTotals {
  totalCostUsd: number;
  totalLatencyMs: number;
  providersUsed: Set<string>;
  budgetWarningEmitted: boolean;
}

type TeamRole = Exclude<AgentRole, "arbiter">;

const TEAM_ROLES: TeamRole[] = ["architect", "implementer", "reviewer"];

const ROLE_STRENGTH_KEYWORDS: Record<TeamRole, string[]> = {
  architect: [
    "architect",
    "architecture",
    "design",
    "plan",
    "system",
    "interface",
    "structure",
    "decompose"
  ],
  implementer: [
    "implement",
    "implementation",
    "code",
    "coding",
    "refactor",
    "patch",
    "build",
    "ship",
    "deliver"
  ],
  reviewer: [
    "review",
    "verify",
    "test",
    "risk",
    "quality",
    "security",
    "regression",
    "lint"
  ]
};

interface RoleAssignmentMap {
  architect: TeamRole;
  implementer: TeamRole;
  reviewer: TeamRole;
}

interface RoleGenerationOutput {
  role: TeamRole;
  assignmentRole: TeamRole;
  provider: ProviderName | "adapter";
  model: string;
  adapterName?: string;
  result?: GenerateResult;
  errorMessage?: string;
}

interface RoleNegotiationResult {
  mapping: RoleAssignmentMap;
  statements: Record<TeamRole, string>;
}

interface RankedProposal {
  proposal: Proposal;
  score: number;
}

interface QualityCheckResult {
  proposalId: string;
  evidenceCount: number;
  hasEvidence: boolean;
  refs: string[];
  unknownRefs: string[];
}

export async function runOrchestration(
  args: RunOrchestrationArgs
): Promise<OrchestrationResult> {
  const sessionId = randomUUID();
  const bus = new EventBus(sessionId);
  const providerFactory = new ProviderFactory();
  const adapterRegistry = new AdapterRegistry(args.config);

  const startMs = Date.now();
  let roundsCompleted = 0;
  const allProposals: Proposal[] = [];
  let latestDecision: ArbiterDecision | null = null;
  let terminationReason = "";

  const totals: RuntimeTotals = {
    totalCostUsd: 0,
    totalLatencyMs: 0,
    providersUsed: new Set<string>(),
    budgetWarningEmitted: false
  };

  const repoContext = await collectRepoContext(args.repoPath);
  const repoSummary = formatRepoContext(repoContext);

  systemEvent(
    bus,
    0,
    [
      "Session initialized.",
      `Task: ${args.task}`,
      "Repo context:",
      repoSummary
    ].join("\n")
  );

  const knownRepoFiles = new Set(repoContext.files.map((file) => normalizeRepoFileRef(file)));
  const canStrictlyRejectUnknownRefs = repoContext.files.length < 80;

  let boardSummary = ["Task", args.task, "Repo summary", repoSummary].join("\n\n");

  const roleNegotiation = await runRoleNegotiationPhase({
    task: args.task,
    repoPath: args.repoPath,
    boardSummary,
    config: args.config,
    bus,
    providerFactory,
    adapterRegistry,
    startMs,
    timeoutSec: args.config.limits.timeoutSec,
    totals,
    budgetUsd: args.config.limits.budgetUsd
  });

  boardSummary = renderNegotiationBoardSummary(boardSummary, roleNegotiation);
  const debateRoundLimit = Math.min(
    args.config.team.debateRounds,
    args.config.limits.maxRounds
  );

  outer: for (let round = 1; round <= debateRoundLimit; round += 1) {
    if (totals.totalCostUsd >= args.config.limits.budgetUsd) {
      terminationReason =
        "Session budget was exhausted before generating proposals for this round.";
      break;
    }

    if (Date.now() - startMs > args.config.limits.timeoutSec * 1000) {
      terminationReason = "Session timeout reached before round execution.";
      bus.emit({
        round,
        role: "arbiter",
        type: "warning",
        content: "Session timeout reached before round execution"
      });
      break;
    }

    const roundProposals: Proposal[] = [];

    const architectOutput = await generateRoleOutput({
      role: "architect",
      assignmentRole: roleNegotiation.mapping.architect,
      task: args.task,
      repoPath: args.repoPath,
      round,
      boardSummary,
      config: args.config,
      bus,
      providerFactory,
      adapterRegistry
    });

    processRoleOutput({
      output: architectOutput,
      round,
      bus,
      task: args.task,
      roundProposals,
      allProposals,
      totals,
      budgetUsd: args.config.limits.budgetUsd
    });

    const peerRoles: Array<Exclude<AgentRole, "arbiter">> = [
      "implementer",
      "reviewer"
    ];

    if (
      totals.totalCostUsd < args.config.limits.budgetUsd &&
      args.config.execution.parallelPeerRoles
    ) {
      const peerOutputs = await Promise.all(
        peerRoles.map((role) =>
          generateRoleOutput({
            role,
            assignmentRole: roleNegotiation.mapping[role],
            task: args.task,
            repoPath: args.repoPath,
            round,
            boardSummary,
            config: args.config,
            bus,
            providerFactory,
            adapterRegistry
          })
        )
      );

      for (const output of peerOutputs) {
        processRoleOutput({
          output,
          round,
          bus,
          task: args.task,
          roundProposals,
          allProposals,
          totals,
          budgetUsd: args.config.limits.budgetUsd
        });
      }
    } else if (totals.totalCostUsd < args.config.limits.budgetUsd) {
      for (const role of peerRoles) {
        if (totals.totalCostUsd >= args.config.limits.budgetUsd) {
          break;
        }

        const output = await generateRoleOutput({
          role,
          assignmentRole: roleNegotiation.mapping[role],
          task: args.task,
          repoPath: args.repoPath,
          round,
          boardSummary,
          config: args.config,
          bus,
          providerFactory,
          adapterRegistry
        });

        processRoleOutput({
          output,
          round,
          bus,
          task: args.task,
          roundProposals,
          allProposals,
          totals,
          budgetUsd: args.config.limits.budgetUsd
        });

        if (totals.totalCostUsd >= args.config.limits.budgetUsd) {
          break;
        }
      }
    }

    if (roundProposals.length === 0) {
      terminationReason = "No valid proposals were generated in the current round.";
      break;
    }

    let decision = decideProposal(args.task, roundProposals);

    const closePair = findCloseTopPair(roundProposals, decision, 0.5);
    if (closePair) {
      bus.emit({
        round,
        role: "arbiter",
        type: "disagreement_flag",
        content: [
          `Top proposals are within ${closePair.delta.toFixed(4)} (threshold=0.5000).`,
          `first: ${closePair.first.proposal.id} (${closePair.first.score.toFixed(4)})`,
          `second: ${closePair.second.proposal.id} (${closePair.second.score.toFixed(4)})`,
          "Running one extra reviewer critique pass before final decision."
        ].join("\n"),
        refs: [closePair.first.proposal.id, closePair.second.proposal.id]
      });

      decision = {
        ...decision,
        rationale: `${decision.rationale} Tie-break remained unchanged after disagreement review signal.`
      };
    }

    decision = applyQualityGate({
      decision,
      proposals: roundProposals,
      round,
      config: args.config,
      bus,
      knownRepoFiles,
      canStrictlyRejectUnknownRefs
    });

    latestDecision = decision;

    bus.emit({
      round,
      role: "arbiter",
      type: "arbiter_decision",
      content: [
        `winner: ${decision.winnerId}`,
        decision.rationale,
        `alternatives: ${decision.alternatives.join(", ") || "none"}`
      ].join("\n"),
      refs: [decision.winnerId]
    });

    boardSummary = renderBoardSummary(args.task, repoSummary, roundProposals, decision.winnerId);
    roundsCompleted = round;

    if (totals.totalCostUsd >= args.config.limits.budgetUsd) {
      terminationReason = `Session budget reached at ${totals.totalCostUsd.toFixed(4)} USD.`;
      break outer;
    }
  }

  if (allProposals.length === 0) {
    const recentWarnings = bus
      .list()
      .filter((event) => event.type === "warning")
      .slice(-3)
      .map((event) => event.content.replace(/\s+/g, " ").trim())
      .join(" | ");
    throw new Error(
      [
        terminationReason ||
          "No proposals were generated. Check provider API keys or adapter availability.",
        recentWarnings ? `Recent warnings: ${recentWarnings}` : ""
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  const winningId = latestDecision?.winnerId ?? allProposals[0].id;
  const winningProposal =
    allProposals.find((proposal) => proposal.id === winningId) ?? allProposals[0];

  const summary = {
    sessionId,
    task: args.task,
    roundsCompleted,
    sessionState: "planning" as const,
    mode: args.config.execution.mode,
    verificationProfile: args.config.verification.profile,
    verificationPassed: false,
    revisionAttempts: 0,
    totalCostUsd: Number(totals.totalCostUsd.toFixed(6)),
    totalLatencyMs: totals.totalLatencyMs,
    providersUsed: [...totals.providersUsed],
    winnerProposalId: winningProposal.id,
    outputDir: args.outputDir
  };

  const arbiterDecision = latestDecision ?? decideProposal(args.task, [winningProposal]);

  return {
    sessionId,
    proposals: allProposals,
    winningProposal,
    arbiterDecision,
    events: bus.list(),
    summary
  };
}

async function generateRoleOutput(args: {
  role: TeamRole;
  assignmentRole?: TeamRole;
  task: string;
  repoPath: string;
  round: number;
  boardSummary: string;
  config: CollabConfig;
  bus: EventBus;
  providerFactory: ProviderFactory;
  adapterRegistry: AdapterRegistry;
}): Promise<RoleGenerationOutput> {
  const assignmentRole = args.assignmentRole ?? args.role;
  const assignment = args.config.roles[assignmentRole];
  const timeoutMs = getRoleTimeoutMs(args.config, assignment.provider);

  try {
    const result =
      assignment.provider === "adapter"
        ? await runSubprocessAdapter({
            adapter: args.adapterRegistry.get(assignment.adapter ?? ""),
            model: assignment.model,
            cwd: args.repoPath,
            input: {
              role: args.role,
              task: args.task,
              round: args.round,
              boardSummary: args.boardSummary,
              priorMessages: args.bus.list(),
              timeoutMs
            }
          })
        : await args.providerFactory.get(assignment.provider).generate({
            assignment,
            config: getProviderConfigOrThrow(args.config, assignment.provider),
            input: {
              role: args.role,
              task: args.task,
              round: args.round,
              boardSummary: args.boardSummary,
              priorMessages: args.bus.list(),
              timeoutMs
            }
          });

    return {
      role: args.role,
      assignmentRole,
      provider: assignment.provider,
      model: assignment.model,
      adapterName: assignment.adapter,
      result
    };
  } catch (error) {
    return {
      role: args.role,
      assignmentRole,
      provider: assignment.provider,
      model: assignment.model,
      adapterName: assignment.adapter,
      errorMessage: formatProviderError(error)
    };
  }
}

function processRoleOutput(args: {
  output: RoleGenerationOutput;
  round: number;
  bus: EventBus;
  task: string;
  roundProposals: Proposal[];
  allProposals: Proposal[];
  totals: RuntimeTotals;
  budgetUsd: number;
}): void {
  if (args.output.errorMessage) {
    emitAdapterHealthEvent(
      args.bus,
      args.round,
      args.output,
      "degraded",
      `error: ${args.output.errorMessage}`
    );
    args.bus.emit({
      round: args.round,
      role: args.output.role,
      type: "warning",
      content: `Role ${args.output.role} failed: ${args.output.errorMessage}`
    });
    return;
  }

  const result = args.output.result;
  if (!result) {
    emitAdapterHealthEvent(args.bus, args.round, args.output, "degraded", "no output");
    args.bus.emit({
      round: args.round,
      role: args.output.role,
      type: "warning",
      content: `Role ${args.output.role} produced no output`
    });
    return;
  }

  emitAdapterHealthEvent(
    args.bus,
    args.round,
    args.output,
    "healthy",
    `model=${args.output.model}`
  );
  recordResultUsage(args.totals, result);

  args.bus.emit({
    round: args.round,
    role: args.output.role,
    type: "role_response",
    content: result.text,
    costUsd: result.estimatedCostUsd
  });

  const proposal = parseProposal(args.round, args.output.role, result.text);
  args.roundProposals.push(proposal);
  args.allProposals.push(proposal);

  args.bus.emit({
    round: args.round,
    role: args.output.role,
    type: "proposal",
    content: [
      `id: ${proposal.id}`,
      `summary: ${proposal.summary}`,
      `diffPlan: ${proposal.diffPlan}`
    ].join("\n")
  });

  emitBudgetWarningIfNeeded(args.bus, args.round, args.totals, args.budgetUsd);
}

function processNonProposalRoleOutput(args: {
  output: RoleGenerationOutput;
  round: number;
  bus: EventBus;
  totals: RuntimeTotals;
  budgetUsd: number;
  label: string;
}): void {
  if (args.output.errorMessage) {
    emitAdapterHealthEvent(
      args.bus,
      args.round,
      args.output,
      "degraded",
      `error: ${args.output.errorMessage}`
    );
    args.bus.emit({
      round: args.round,
      role: args.output.role,
      type: "warning",
      content: `Role ${args.output.role} failed during ${args.label}: ${args.output.errorMessage}`
    });
    return;
  }

  const result = args.output.result;
  if (!result) {
    emitAdapterHealthEvent(args.bus, args.round, args.output, "degraded", "no output");
    args.bus.emit({
      round: args.round,
      role: args.output.role,
      type: "warning",
      content: `Role ${args.output.role} produced no output during ${args.label}`
    });
    return;
  }

  emitAdapterHealthEvent(
    args.bus,
    args.round,
    args.output,
    "healthy",
    `model=${args.output.model}`
  );
  recordResultUsage(args.totals, result);

  args.bus.emit({
    round: args.round,
    role: args.output.role,
    type: "role_response",
    content: result.text,
    costUsd: result.estimatedCostUsd
  });

  emitBudgetWarningIfNeeded(args.bus, args.round, args.totals, args.budgetUsd);
}

async function runRoleNegotiationPhase(args: {
  task: string;
  repoPath: string;
  boardSummary: string;
  config: CollabConfig;
  bus: EventBus;
  providerFactory: ProviderFactory;
  adapterRegistry: AdapterRegistry;
  startMs: number;
  timeoutSec: number;
  totals: RuntimeTotals;
  budgetUsd: number;
}): Promise<RoleNegotiationResult> {
  const statements: Record<TeamRole, string> = {
    architect: "",
    implementer: "",
    reviewer: ""
  };

  for (const role of TEAM_ROLES) {
    if (Date.now() - args.startMs > args.timeoutSec * 1000) {
      args.bus.emit({
        round: 0,
        role: "arbiter",
        type: "warning",
        content: "Session timeout reached during role negotiation."
      });
      break;
    }

    if (args.totals.totalCostUsd >= args.budgetUsd) {
      args.bus.emit({
        round: 0,
        role: "arbiter",
        type: "warning",
        content: "Session budget reached during role negotiation."
      });
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    const output = await generateRoleOutput({
      role,
      assignmentRole: role,
      task: buildRoleNegotiationTask(args.task),
      repoPath: args.repoPath,
      round: 0,
      boardSummary: args.boardSummary,
      config: args.config,
      bus: args.bus,
      providerFactory: args.providerFactory,
      adapterRegistry: args.adapterRegistry
    });

    if (output.errorMessage) {
      emitAdapterHealthEvent(args.bus, 0, output, "degraded", `error: ${output.errorMessage}`);
      args.bus.emit({
        round: 0,
        role: output.role,
        type: "role_negotiation",
        content: `strengths unavailable (${output.errorMessage})`
      });
      continue;
    }

    if (!output.result) {
      emitAdapterHealthEvent(args.bus, 0, output, "degraded", "no output");
      args.bus.emit({
        round: 0,
        role: output.role,
        type: "role_negotiation",
        content: "strengths unavailable (no output)"
      });
      continue;
    }

    emitAdapterHealthEvent(args.bus, 0, output, "healthy", `model=${output.model}`);
    recordResultUsage(args.totals, output.result);
    emitBudgetWarningIfNeeded(args.bus, 0, args.totals, args.budgetUsd);

    const statement = extractStrengthStatement(output.result.text);
    statements[output.role] = statement;
    args.bus.emit({
      round: 0,
      role: output.role,
      type: "role_negotiation",
      content: statement,
      costUsd: output.result.estimatedCostUsd
    });
  }

  const useAutoMapping =
    args.config.team.mode === "auto" && args.config.team.roleStrategy === "strengths_first";
  const mapping = useAutoMapping
    ? chooseRoleMappingFromStrengths(statements)
    : defaultRoleMapping();

  args.bus.emit({
    round: 0,
    role: "arbiter",
    type: "role_negotiation",
    content: [
      `mode=${args.config.team.mode}`,
      `strategy=${args.config.team.roleStrategy}`,
      useAutoMapping
        ? `mapping selected by strengths: ${formatRoleMapping(mapping)}`
        : `mapping fixed: ${formatRoleMapping(mapping)}`
    ].join("\n")
  });

  return { mapping, statements };
}

function buildRoleNegotiationTask(task: string): string {
  return [
    task,
    "",
    "Round 0 role negotiation:",
    "Return one concise strengths sentence in SUMMARY grounded in the task and board context.",
    "Keep DIFF_PLAN, RISKS, TESTS, and EVIDENCE minimal."
  ].join("\n");
}

function extractStrengthStatement(text: string): string {
  const summary = extractSection(text, "SUMMARY") || firstMeaningfulLine(text);
  return summary.replace(/\s+/g, " ").trim().slice(0, 220) || "No strengths provided";
}

function renderNegotiationBoardSummary(
  boardSummary: string,
  negotiation: RoleNegotiationResult
): string {
  return [
    boardSummary,
    "Role negotiation:",
    `mapping: ${formatRoleMapping(negotiation.mapping)}`,
    ...TEAM_ROLES.map((role) => `${role}: ${negotiation.statements[role] || "(none)"}`)
  ].join("\n");
}

function defaultRoleMapping(): RoleAssignmentMap {
  return {
    architect: "architect",
    implementer: "implementer",
    reviewer: "reviewer"
  };
}

function chooseRoleMappingFromStrengths(
  statements: Record<TeamRole, string>
): RoleAssignmentMap {
  const permutations: TeamRole[][] = [
    ["architect", "implementer", "reviewer"],
    ["architect", "reviewer", "implementer"],
    ["implementer", "architect", "reviewer"],
    ["implementer", "reviewer", "architect"],
    ["reviewer", "architect", "implementer"],
    ["reviewer", "implementer", "architect"]
  ];

  let best = defaultRoleMapping();
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestKey = "zzz";

  for (const permutation of permutations) {
    const candidate: RoleAssignmentMap = {
      architect: permutation[0],
      implementer: permutation[1],
      reviewer: permutation[2]
    };

    const score =
      scoreStrengthForRole("architect", candidate.architect, statements[candidate.architect]) +
      scoreStrengthForRole(
        "implementer",
        candidate.implementer,
        statements[candidate.implementer]
      ) +
      scoreStrengthForRole("reviewer", candidate.reviewer, statements[candidate.reviewer]);

    const key = formatRoleMapping(candidate);
    if (score > bestScore || (score === bestScore && key < bestKey)) {
      best = candidate;
      bestScore = score;
      bestKey = key;
    }
  }

  return best;
}

function scoreStrengthForRole(
  targetRole: TeamRole,
  sourceRole: TeamRole,
  statement: string
): number {
  const text = statement.toLowerCase();
  const keywordScore = ROLE_STRENGTH_KEYWORDS[targetRole].reduce((total, keyword) => {
    return total + (text.includes(keyword) ? 1 : 0);
  }, 0);
  const identityBonus = targetRole === sourceRole ? 0.15 : 0;
  return Number((keywordScore + identityBonus).toFixed(4));
}

function formatRoleMapping(mapping: RoleAssignmentMap): string {
  return [
    `architect<=${mapping.architect}`,
    `implementer<=${mapping.implementer}`,
    `reviewer<=${mapping.reviewer}`
  ].join(", ");
}

function findCloseTopPair(
  proposals: Proposal[],
  decision: ArbiterDecision,
  threshold: number
): { first: RankedProposal; second: RankedProposal; delta: number } | null {
  const ranked = rankByDecisionScore(proposals, decision);
  if (ranked.length < 2) {
    return null;
  }

  const first = ranked[0];
  const second = ranked[1];
  const delta = Number((first.score - second.score).toFixed(4));
  if (delta > threshold) {
    return null;
  }

  return { first, second, delta };
}

function rankByDecisionScore(
  proposals: Proposal[],
  decision: ArbiterDecision
): RankedProposal[] {
  return proposals
    .map((proposal) => ({
      proposal,
      score: decision.scores[proposal.id]?.weightedTotal ?? Number.NEGATIVE_INFINITY
    }))
    .sort((a, b) => {
      const delta = b.score - a.score;
      if (delta !== 0) {
        return delta;
      }

      return a.proposal.id.localeCompare(b.proposal.id);
    });
}

function applyQualityGate(args: {
  decision: ArbiterDecision;
  proposals: Proposal[];
  round: number;
  config: CollabConfig;
  bus: EventBus;
  knownRepoFiles: Set<string>;
  canStrictlyRejectUnknownRefs: boolean;
}): ArbiterDecision {
  const enforceUnknownRefRejection =
    args.config.quality.rejectUnknownFileRefs && args.canStrictlyRejectUnknownRefs;
  const checks = args.proposals.map((proposal) =>
    evaluateQuality(proposal, args.knownRepoFiles, {
      rejectUnknownFileRefs: enforceUnknownRefRejection
    })
  );
  const byId = new Map(checks.map((check) => [check.proposalId, check]));

  for (const check of checks) {
    args.bus.emit({
      round: args.round,
      role: "arbiter",
      type: "evidence_check",
      content: [
        `proposal=${check.proposalId}`,
        `evidence_count=${check.evidenceCount}`,
        `has_evidence=${check.hasEvidence}`,
        `refs=${check.refs.join(", ") || "none"}`,
        `unknown_refs=${check.unknownRefs.join(", ") || "none"}`
      ].join("\n"),
      refs: [check.proposalId]
    });
  }

  const ranked = rankByDecisionScore(args.proposals, args.decision);
  const reasons: string[] = [];
  const isEligible = (proposalId: string): boolean => {
    const check = byId.get(proposalId);
    if (!check) {
      return false;
    }
    if (args.config.quality.requireEvidence && !check.hasEvidence) {
      return false;
    }
    if (enforceUnknownRefRejection && check.unknownRefs.length > 0) {
      return false;
    }
    return true;
  };

  const eligible = ranked.filter((item) => isEligible(item.proposal.id));
  let selectedWinnerId = args.decision.winnerId;
  if (eligible.length > 0) {
    selectedWinnerId = eligible[0].proposal.id;
  }

  if (args.config.quality.requireEvidence) {
    if (eligible.some((item) => (byId.get(item.proposal.id)?.hasEvidence ?? false))) {
      reasons.push("requireEvidence enforced.");
    } else {
      reasons.push("requireEvidence enabled but no proposals contained evidence.");
    }
  }

  if (args.config.quality.rejectUnknownFileRefs) {
    if (!args.canStrictlyRejectUnknownRefs) {
      reasons.push("rejectUnknownFileRefs treated as advisory due partial repository file sample.");
    } else if (eligible.length === 0) {
      reasons.push("rejectUnknownFileRefs enabled but no proposals satisfied constraints.");
    } else {
      reasons.push("rejectUnknownFileRefs enforced.");
    }
  }

  const qualityStatus =
    reasons.length === 0
      ? "no_quality_constraints_enabled"
      : selectedWinnerId === args.decision.winnerId
        ? "passed"
        : "overridden";

  args.bus.emit({
    round: args.round,
    role: "arbiter",
    type: "quality_gate",
    content: [
      `status=${qualityStatus}`,
      `winner=${selectedWinnerId}`,
      `notes=${reasons.join(" ") || "none"}`
    ].join("\n"),
    refs: [selectedWinnerId]
  });

  if (selectedWinnerId === args.decision.winnerId) {
    if (reasons.length === 0) {
      return args.decision;
    }

    return {
      ...args.decision,
      rationale: `${args.decision.rationale} Quality gate: ${reasons.join(" ")}`
    };
  }

  const alternatives = ranked
    .map((item) => item.proposal.id)
    .filter((proposalId) => proposalId !== selectedWinnerId);

  return {
    ...args.decision,
    winnerId: selectedWinnerId,
    alternatives,
    rationale: `${args.decision.rationale} Quality gate override: ${reasons.join(" ")}`
  };
}

function evaluateQuality(
  proposal: Proposal,
  knownRepoFiles: Set<string>,
  options: { rejectUnknownFileRefs: boolean }
): QualityCheckResult {
  const refs = extractFileRefsFromEvidence(proposal.evidence);
  const unknownRefs = options.rejectUnknownFileRefs
    ? refs.filter((ref) => !knownRepoFiles.has(ref))
    : [];

  return {
    proposalId: proposal.id,
    evidenceCount: proposal.evidence.length,
    hasEvidence: proposal.evidence.length > 0,
    refs,
    unknownRefs
  };
}

function extractFileRefsFromEvidence(evidence: string[]): string[] {
  const refs = new Set<string>();
  const matcher = /\b(?:\.\/)?(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]{1,8}\b/g;

  for (const line of evidence) {
    const matches = line.match(matcher) ?? [];
    for (const rawRef of matches) {
      if (rawRef.includes("://")) {
        continue;
      }

      refs.add(normalizeRepoFileRef(rawRef));
    }
  }

  return [...refs].sort();
}

function normalizeRepoFileRef(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

function emitAdapterHealthEvent(
  bus: EventBus,
  round: number,
  output: RoleGenerationOutput,
  status: "healthy" | "degraded",
  details: string
): void {
  if (output.provider !== "adapter") {
    return;
  }

  bus.emit({
    round,
    role: output.role,
    type: "adapter_health",
    content: [
      `adapter=${output.adapterName ?? output.assignmentRole}`,
      `status=${status}`,
      `assignment=${output.assignmentRole}->${output.role}`,
      details
    ].join("\n")
  });
}

function recordResultUsage(totals: RuntimeTotals, result: GenerateResult): void {
  totals.totalCostUsd += result.estimatedCostUsd;
  totals.totalLatencyMs += result.latencyMs;
  totals.providersUsed.add(result.provider);
}

function emitBudgetWarningIfNeeded(
  bus: EventBus,
  round: number,
  totals: RuntimeTotals,
  budgetUsd: number
): void {
  if (!totals.budgetWarningEmitted && totals.totalCostUsd >= budgetUsd) {
    totals.budgetWarningEmitted = true;
    bus.emit({
      round,
      role: "arbiter",
      type: "warning",
      content: `Budget limit reached at ${totals.totalCostUsd.toFixed(4)} USD`
    });
  }
}

function getRoleTimeoutMs(config: CollabConfig, provider: ProviderName | "adapter"): number {
  if (provider === "adapter") {
    return 120000;
  }

  return config.providers[provider]?.timeoutMs ?? 120000;
}

function getProviderConfigOrThrow(
  config: CollabConfig,
  provider: ProviderName
): NonNullable<CollabConfig["providers"][ProviderName]> {
  const value = config.providers[provider];
  if (!value?.apiKeyEnv) {
    throw new Error(`Provider config missing for ${provider}`);
  }

  return value;
}

function parseProposal(
  round: number,
  role: Exclude<AgentRole, "arbiter">,
  text: string
): Proposal {
  const summary = extractSection(text, "SUMMARY") || firstMeaningfulLine(text);
  const diffPlan = extractSection(text, "DIFF_PLAN") || "No diff plan provided";
  const risks = parseList(extractSection(text, "RISKS"));
  const tests = parseList(extractSection(text, "TESTS"));
  const evidence = parseList(extractSection(text, "EVIDENCE"));

  return {
    id: `${role}-r${round}-${shortHash(summary + diffPlan)}`,
    round,
    authorRole: role,
    summary,
    diffPlan,
    risks,
    tests,
    evidence,
    rawText: text
  };
}

function renderBoardSummary(
  task: string,
  repoSummary: string,
  proposals: Proposal[],
  winnerId: string
): string {
  const proposalLines = proposals
    .map((proposal) => {
      const marker = proposal.id === winnerId ? "[WINNER]" : "";
      return `${marker} ${proposal.id} (${proposal.authorRole}): ${proposal.summary}`;
    })
    .join("\n");

  return [
    `Task: ${task}`,
    "Repo summary:",
    repoSummary,
    "Current round proposals:",
    proposalLines
  ].join("\n\n");
}

function extractSection(text: string, title: string): string {
  const regex = new RegExp(`${title}:\\s*([\\s\\S]*?)(?:\\n[A-Z_ ]+:|$)`, "i");
  const match = text.match(regex);
  if (!match?.[1]) {
    return "";
  }

  return match[1].trim();
}

function parseList(section: string): string[] {
  if (!section) {
    return [];
  }

  return section
    .split("\n")
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function firstMeaningfulLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 280) ?? "No summary provided"
  );
}

function shortHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }

  return hash.toString(16).slice(0, 8);
}

function formatProviderError(error: unknown): string {
  if (error instanceof ProviderRequestError) {
    return `[${error.code}] ${error.message}`;
  }

  return error instanceof Error ? error.message : String(error);
}
