import type { ArbiterDecision, Proposal, ProposalScores } from "../types/index.js";

const WEIGHTS = {
  alignment: 0.3,
  feasibility: 0.25,
  safety: 0.2,
  testability: 0.15,
  efficiency: 0.1
} as const;

export function decideProposal(
  task: string,
  proposals: Proposal[]
): ArbiterDecision {
  if (proposals.length === 0) {
    throw new Error("No proposals provided to arbiter");
  }

  const scores: Record<string, ProposalScores> = {};

  for (const proposal of proposals) {
    scores[proposal.id] = scoreProposal(task, proposal);
  }

  const ranked = [...proposals].sort((a, b) => {
    const delta = scores[b.id].weightedTotal - scores[a.id].weightedTotal;
    if (delta !== 0) {
      return delta;
    }

    return a.id.localeCompare(b.id);
  });

  const winner = ranked[0];
  const alternatives = ranked.slice(1).map((proposal) => proposal.id);

  const rationale = `Selected ${winner.id} with weighted score ${scores[
    winner.id
  ].weightedTotal.toFixed(2)}. Secondary options: ${
    alternatives.length > 0 ? alternatives.join(", ") : "none"
  }.`;

  return {
    winnerId: winner.id,
    scores,
    rationale,
    alternatives
  };
}

export function scoreProposal(task: string, proposal: Proposal): ProposalScores {
  const alignment = scoreAlignment(task, proposal);
  const feasibility = scoreFeasibility(proposal);
  const safety = scoreSafety(proposal);
  const testability = scoreTestability(proposal);
  const efficiency = scoreEfficiency(proposal);

  const weightedTotal =
    alignment * WEIGHTS.alignment +
    feasibility * WEIGHTS.feasibility +
    safety * WEIGHTS.safety +
    testability * WEIGHTS.testability +
    efficiency * WEIGHTS.efficiency;

  return {
    alignment,
    feasibility,
    safety,
    testability,
    efficiency,
    weightedTotal: Number(weightedTotal.toFixed(4))
  };
}

function scoreAlignment(task: string, proposal: Proposal): number {
  const taskTokens = uniqueTokens(task);
  const proposalTokens = uniqueTokens(`${proposal.summary} ${proposal.diffPlan}`);

  if (taskTokens.length === 0 || proposalTokens.length === 0) {
    return 1;
  }

  const overlap = taskTokens.filter((token) => proposalTokens.includes(token)).length;
  const ratio = overlap / taskTokens.length;

  return clamp(1 + ratio * 4, 0, 5);
}

function scoreFeasibility(proposal: Proposal): number {
  let score = 2.5;
  const diff = proposal.diffPlan.toLowerCase();

  if (/step|phase|increment|module|file/.test(diff)) {
    score += 1.5;
  }

  if (/rewrite everything|from scratch|big bang/.test(diff)) {
    score -= 1.2;
  }

  if (proposal.diffPlan.length > 1200) {
    score -= 0.5;
  }

  return clamp(score, 0, 5);
}

function scoreSafety(proposal: Proposal): number {
  let score = 1.5;
  score += Math.min(2, proposal.risks.length * 0.5);

  const text = `${proposal.rawText} ${proposal.diffPlan}`.toLowerCase();
  if (/rollback|fallback|redact|secret|security|validate/.test(text)) {
    score += 1.5;
  }

  return clamp(score, 0, 5);
}

function scoreTestability(proposal: Proposal): number {
  let score = 1;
  score += Math.min(3, proposal.tests.length * 0.7);

  const text = `${proposal.rawText} ${proposal.diffPlan}`.toLowerCase();
  if (/unit test|integration|e2e|acceptance/.test(text)) {
    score += 1;
  }

  return clamp(score, 0, 5);
}

function scoreEfficiency(proposal: Proposal): number {
  let score = 2.5;

  if (proposal.diffPlan.length < 500) {
    score += 1.2;
  }

  if (/incremental|minimal|focused/.test(proposal.diffPlan.toLowerCase())) {
    score += 0.8;
  }

  if (/full rewrite|complete overhaul/.test(proposal.diffPlan.toLowerCase())) {
    score -= 1.5;
  }

  return clamp(score, 0, 5);
}

function uniqueTokens(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])];
}

function clamp(value: number, min: number, max: number): number {
  return Number(Math.max(min, Math.min(max, value)).toFixed(4));
}
