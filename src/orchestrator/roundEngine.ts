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

interface RoleGenerationOutput {
  role: Exclude<AgentRole, "arbiter">;
  result?: GenerateResult;
  errorMessage?: string;
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

  let boardSummary = ["Task", args.task, "Repo summary", repoSummary].join("\n\n");

  outer: for (let round = 1; round <= args.config.limits.maxRounds; round += 1) {
    if (Date.now() - startMs > args.config.limits.timeoutSec * 1000) {
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
      task: args.task,
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

    if (totals.totalCostUsd >= args.config.limits.budgetUsd) {
      break outer;
    }

    const peerRoles: Array<Exclude<AgentRole, "arbiter">> = [
      "implementer",
      "reviewer"
    ];

    if (args.config.execution.parallelPeerRoles) {
      const peerOutputs = await Promise.all(
        peerRoles.map((role) =>
          generateRoleOutput({
            role,
            task: args.task,
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
    } else {
      for (const role of peerRoles) {
        const output = await generateRoleOutput({
          role,
          task: args.task,
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
      break;
    }

    const decision = decideProposal(args.task, roundProposals);
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
      break outer;
    }
  }

  if (allProposals.length === 0) {
    throw new Error(
      "No proposals were generated. Check provider API keys or adapter availability."
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
  role: Exclude<AgentRole, "arbiter">;
  task: string;
  round: number;
  boardSummary: string;
  config: CollabConfig;
  bus: EventBus;
  providerFactory: ProviderFactory;
  adapterRegistry: AdapterRegistry;
}): Promise<RoleGenerationOutput> {
  const assignment = args.config.roles[args.role];
  const timeoutMs = getRoleTimeoutMs(args.config, assignment.provider);

  try {
    const result =
      assignment.provider === "adapter"
        ? await runSubprocessAdapter({
            adapter: args.adapterRegistry.get(assignment.adapter ?? ""),
            model: assignment.model,
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
      result
    };
  } catch (error) {
    return {
      role: args.role,
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
    args.bus.emit({
      round: args.round,
      role: args.output.role,
      type: "warning",
      content: `Role ${args.output.role} produced no output`
    });
    return;
  }

  args.totals.totalCostUsd += result.estimatedCostUsd;
  args.totals.totalLatencyMs += result.latencyMs;
  args.totals.providersUsed.add(result.provider);

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

  if (
    !args.totals.budgetWarningEmitted &&
    args.totals.totalCostUsd >= args.budgetUsd
  ) {
    args.totals.budgetWarningEmitted = true;
    args.bus.emit({
      round: args.round,
      role: "arbiter",
      type: "warning",
      content: `Budget limit reached at ${args.totals.totalCostUsd.toFixed(4)} USD`
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
    .map((line) => line.replace(/^[-*\\d.\\s]+/, "").trim())
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
