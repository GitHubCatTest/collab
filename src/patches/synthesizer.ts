import type { CandidatePatch, Proposal } from "../types/index.js";

const FALLBACK_FILE = "COLLAB_PROPOSED_CHANGES.md";

export function buildCandidatePatch(proposal: Proposal): CandidatePatch {
  const modelPatch = extractPatchFromModel(proposal.rawText);
  if (modelPatch) {
    return {
      patch: normalizePatch(modelPatch),
      source: "model",
      targetFiles: extractTargetFiles(modelPatch)
    };
  }

  return {
    patch: renderFallbackPatch(proposal),
    source: "fallback",
    targetFiles: [FALLBACK_FILE]
  };
}

export function validateUnifiedPatch(patch: string): {
  valid: boolean;
  reason?: string;
} {
  if (!patch.trim()) {
    return {
      valid: false,
      reason: "patch is empty"
    };
  }

  if (!patch.includes("diff --git")) {
    return {
      valid: false,
      reason: "patch is missing unified diff headers"
    };
  }

  if (!patch.includes("--- ") || !patch.includes("+++ ")) {
    return {
      valid: false,
      reason: "patch is missing file markers (---/+++)"
    };
  }

  return { valid: true };
}

function extractPatchFromModel(text: string): string | null {
  const sectionMatch = text.match(/PATCH_DIFF:\s*([\s\S]*?)(?:\n[A-Z_ ]+:|$)/i);
  if (sectionMatch?.[1]?.trim()) {
    return sectionMatch[1].trim();
  }

  const fenced = text.match(/```diff\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim();
  }

  return null;
}

function normalizePatch(patch: string): string {
  const trimmed = patch.trim();
  return `${trimmed}\n`;
}

function extractTargetFiles(patch: string): string[] {
  const matches = [...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)];
  if (matches.length === 0) {
    return [];
  }

  return matches.map((match) => match[2]);
}

function renderFallbackPatch(proposal: Proposal): string {
  const summaryLines = normalizeTextLines(proposal.summary);
  const diffPlanLines = normalizeTextLines(proposal.diffPlan);
  const riskLines =
    proposal.risks.length > 0
      ? proposal.risks.flatMap((risk) => normalizeTextLines(risk))
      : ["None"];
  const testLines =
    proposal.tests.length > 0
      ? proposal.tests.flatMap((item) => normalizeTextLines(item))
      : ["None"];

  const content = [
    "# Proposed Changes",
    "",
    `Proposal ID: ${proposal.id}`,
    "",
    "## Summary",
    ...summaryLines,
    "",
    "## Diff Plan",
    ...diffPlanLines,
    "",
    "## Risks",
    ...riskLines,
    "",
    "## Tests",
    ...testLines
  ];

  const patchLines = [
    `diff --git a/${FALLBACK_FILE} b/${FALLBACK_FILE}`,
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    `+++ b/${FALLBACK_FILE}`,
    `@@ -0,0 +1,${content.length} @@`,
    ...content.map((line) => `+${line}`)
  ];

  return `${patchLines.join("\n")}\n`;
}

function normalizeTextLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}
