import type {
  PlanSectionKey,
  StructuredPlan
} from "./types.js";

const SECTION_KEYS: PlanSectionKey[] = [
  "agreements",
  "disagreements",
  "techStack",
  "implementationSteps",
  "risks"
];

const SECTION_ALIASES: Record<PlanSectionKey, string[]> = {
  agreements: ["agreements", "agreement", "consensus", "alignments"],
  disagreements: ["disagreements", "disagreement", "open questions", "trade-offs"],
  techStack: ["tech stack", "technology stack", "stack"],
  implementationSteps: [
    "implementation steps",
    "implementation plan",
    "execution steps",
    "plan of attack"
  ],
  risks: ["risks", "risk", "concerns", "issues"]
};

const LIST_PREFIX_RE = /^([-*+]|\d+[.)])\s+/;
const RISK_HINT_RE =
  /\b(risk|failure|rollback|incident|security|downtime|latency|leak)\b/i;
const TECH_HINT_RE =
  /\b(node|typescript|react|next|postgres|mysql|redis|kafka|docker|kubernetes|aws|gcp|azure|terraform|grpc)\b/i;
const DISAGREEMENT_HINT_RE =
  /\b(vs\.?|versus|trade-?off|alternative|disagree|option)\b/i;

export function parseStructuredPlan(markdown: string): StructuredPlan {
  const normalized = normalize(markdown);
  const extracted = extractSections(normalized);
  const rawSections: Partial<Record<PlanSectionKey, string>> = {};

  for (const key of SECTION_KEYS) {
    const value = normalize(extracted.get(key) ?? "");
    if (value) {
      rawSections[key] = value;
    }
  }

  const base = {
    agreements: parseItems(rawSections.agreements ?? ""),
    disagreements: parseItems(rawSections.disagreements ?? ""),
    techStack: parseItems(rawSections.techStack ?? ""),
    implementationSteps: parseItems(rawSections.implementationSteps ?? ""),
    risks: parseItems(rawSections.risks ?? "")
  };

  const missingSections = SECTION_KEYS.filter((key) => !rawSections[key]);
  const fallbackUsed = missingSections.length > 0;
  if (!fallbackUsed) {
    return {
      ...base,
      rawSections,
      missingSections,
      fallbackUsed
    };
  }

  const fallbackItems = parseItems(normalized);
  const firstLine = firstMeaningfulLine(normalized);
  const withFallback = { ...base };

  if (withFallback.agreements.length === 0 && firstLine) {
    withFallback.agreements = [firstLine];
  }

  if (withFallback.implementationSteps.length === 0) {
    withFallback.implementationSteps =
      fallbackItems.length > 0 ? fallbackItems.slice(0, 8) : firstLine ? [firstLine] : [];
  }

  if (withFallback.techStack.length === 0) {
    withFallback.techStack = fallbackItems.filter((item) => TECH_HINT_RE.test(item)).slice(0, 8);
  }

  if (withFallback.risks.length === 0) {
    withFallback.risks = fallbackItems.filter((item) => RISK_HINT_RE.test(item)).slice(0, 8);
  }

  if (withFallback.disagreements.length === 0) {
    withFallback.disagreements = fallbackItems
      .filter((item) => DISAGREEMENT_HINT_RE.test(item))
      .slice(0, 8);
  }

  return {
    ...withFallback,
    rawSections,
    missingSections,
    fallbackUsed
  };
}

function extractSections(markdown: string): Map<PlanSectionKey, string> {
  const lines = markdown.split("\n");
  const buckets = new Map<PlanSectionKey, string[]>();
  let current: PlanSectionKey | null = null;

  for (const line of lines) {
    const heading = toSectionKey(line);
    if (heading) {
      current = heading;
      if (!buckets.has(heading)) {
        buckets.set(heading, []);
      }
      continue;
    }

    if (current) {
      buckets.get(current)?.push(line);
    }
  }

  const result = new Map<PlanSectionKey, string>();
  for (const key of SECTION_KEYS) {
    const block = normalize((buckets.get(key) ?? []).join("\n"));
    if (block) {
      result.set(key, block);
    }
  }
  return result;
}

function toSectionKey(line: string): PlanSectionKey | null {
  const markdownHeading = line.match(/^\s{0,3}#{1,6}\s*(.+?)\s*#*\s*$/);
  const labelHeading = line.match(/^\s*([A-Za-z][A-Za-z \-]{2,})\s*:\s*$/);
  const rawHeading = markdownHeading?.[1] ?? labelHeading?.[1];
  if (!rawHeading) {
    return null;
  }

  const normalizedHeading = normalizeHeading(rawHeading);
  for (const key of SECTION_KEYS) {
    if (SECTION_ALIASES[key].includes(normalizedHeading)) {
      return key;
    }
  }

  return null;
}

function normalizeHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseItems(value: string): string[] {
  if (!value.trim()) {
    return [];
  }

  const lines = value.split("\n");
  const hasBullets = lines.some((line) => LIST_PREFIX_RE.test(line.trim()));
  if (!hasBullets) {
    return dedupe(
      value
        .split(/\n\s*\n/)
        .map((part) => collapseWhitespace(part))
        .filter(Boolean)
    );
  }

  const items: string[] = [];
  let current = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushCurrent(items, current);
      current = "";
      continue;
    }

    const bullet = trimmed.match(/^([-*+]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      flushCurrent(items, current);
      current = bullet[2].trim();
      continue;
    }

    current = current ? `${current} ${trimmed}` : trimmed;
  }
  flushCurrent(items, current);

  return dedupe(items.map((item) => collapseWhitespace(item)).filter(Boolean));
}

function flushCurrent(items: string[], current: string): void {
  const value = collapseWhitespace(current);
  if (value) {
    items.push(value);
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }
  return output;
}

function firstMeaningfulLine(value: string): string {
  for (const line of value.split("\n")) {
    const trimmed = collapseWhitespace(line);
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}
