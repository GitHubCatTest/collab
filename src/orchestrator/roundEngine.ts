import { randomUUID } from "node:crypto";
import { AdapterRegistry } from "../adapters/registry.js";
import { runSubprocessAdapter } from "../adapters/subprocessAdapter.js";
import { decideProposal } from "../arbiter/scorer.js";
import { EventBus, systemEvent } from "../bus/eventBus.js";
import { ProviderFactory } from "../providers/factory.js";
import type {
  AgentRole,
  ArbiterDecision,
  CollabConfig,
  OrchestrationResult,
  Proposal,
  ProposalScores,
  ProviderName
} from "../types/index.js";
import { collectRepoContext, formatRepoContext } from "./context.js";

export interface RunOrchestrationArgs {
  task: string;
  repoPath: string;
  config: CollabConfig;
  outputDir: string;
}

export async function runOrchestration(
  args: RunOrchestrationArgs
): Promise<OrchestrationResult> {
  const sessionId = randomUUID();
  const bus = new EventBus(sessionId);
  const providerFactory = new ProviderFactory();
  const adapterRegistry = new AdapterRegistry(args.config);

  const startMs = Date.now();
  let totalCostUsd = 0;
  let totalLatencyMs = 0;
  let roundsCompleted = 0;
  const providersUsed = new Set<string>();
  const allProposals: Proposal[] = [];
  let latestDecision: ArbiterDecision | null = null;

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
    const roles: Array<Exclude<AgentRole, "arbiter">> = [
      "architect",
      "implementer",
      "reviewer"
    ];

    for (const role of roles) {
      const assignment = args.config.roles[role];
      const timeoutMs = getRoleTimeoutMs(args.config, assignment.provider);

      try {
        const result =
          assignment.provider === "adapter"
            ? await runSubprocessAdapter({
                adapter: adapterRegistry.get(assignment.adapter ?? ""),
                model: assignment.model,
                input: {
                  role,
                  task: args.task,
                  round,
                  boardSummary,
                  priorMessages: bus.list(),
                  timeoutMs
                }
              })
            : await providerFactory.get(assignment.provider).generate({
                assignment,
                config: getProviderConfigOrThrow(args.config, assignment.provider),
                input: {
                  role,
                  task: args.task,
                  round,
                  boardSummary,
                  priorMessages: bus.list(),
                  timeoutMs
                }
              });

        totalCostUsd += result.estimatedCostUsd;
        totalLatencyMs += result.latencyMs;
        providersUsed.add(result.provider);

        bus.emit({
          round,
          role,
          type: "role_response",
          content: result.text,
          costUsd: result.estimatedCostUsd
        });

        const proposal = parseProposal(round, role, result.text);
        roundProposals.push(proposal);
        allProposals.push(proposal);

        bus.emit({
          round,
          role,
          type: "proposal",
          content: [
            `id: ${proposal.id}`,
            `summary: ${proposal.summary}`,
            `diffPlan: ${proposal.diffPlan}`
          ].join("\n")
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bus.emit({
          round,
          role,
          type: "warning",
          content: `Role ${role} failed: ${message}`
        });
      }

      if (totalCostUsd >= args.config.limits.budgetUsd) {
        bus.emit({
          round,
          role: "arbiter",
          type: "warning",
          content: `Budget limit reached at ${totalCostUsd.toFixed(4)} USD`
        });
        break;
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

    if (totalCostUsd >= args.config.limits.budgetUsd) {
      break outer;
    }
  }

  if (allProposals.length === 0) {
    throw new Error(
      "No proposals were generated. Check provider API keys or adapter availability."
    );
  }

  const winningId = latestDecision?.winnerId ?? allProposals[0].id;
  const winningProposal = allProposals.find((proposal) => proposal.id === winningId) ?? allProposals[0];

  const summary = {
    sessionId,
    task: args.task,
    roundsCompleted,
    totalCostUsd: Number(totalCostUsd.toFixed(6)),
    totalLatencyMs,
    providersUsed: [...providersUsed],
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
