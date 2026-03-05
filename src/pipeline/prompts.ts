import type {
  CollaborationFocus,
  PromptMessage,
  StageOutput
} from "./types.js";

interface PromptBaseArgs {
  task: string;
  context?: string;
  focus: CollaborationFocus;
}

interface SeedPromptArgs extends PromptBaseArgs {
  providerId: string;
  providerIndex: number;
  providerCount: number;
}

interface RefinePromptArgs extends PromptBaseArgs {
  layer: number;
  priorOutputs: StageOutput[];
}

interface SynthesisPromptArgs extends PromptBaseArgs {
  priorOutputs: StageOutput[];
}

interface Perspective {
  name: string;
  emphasis: string;
}

const PERSPECTIVES: Perspective[] = [
  {
    name: "scalability",
    emphasis:
      "Prioritize system boundaries, scaling paths, caching, and performance trade-offs."
  },
  {
    name: "simplicity",
    emphasis:
      "Prioritize maintainability, clear ownership, easy onboarding, and minimal operational complexity."
  },
  {
    name: "security",
    emphasis:
      "Prioritize threat modeling, abuse prevention, observability, and failure containment."
  }
];

export function buildSeedMessages(args: SeedPromptArgs): PromptMessage[] {
  const perspective = PERSPECTIVES[args.providerIndex % PERSPECTIVES.length];

  return [
    {
      role: "system",
      content: [
        `You are provider ${args.providerId} (${args.providerIndex + 1}/${args.providerCount}) in a collaborative planning panel.`,
        `Primary lens: ${perspective.name}.`,
        perspective.emphasis,
        `Focus override: ${args.focus}.`,
        "Return concise markdown. Other models will refine this output."
      ].join("\n")
    },
    {
      role: "user",
      content: buildTaskBlock(args)
    }
  ];
}

export function buildRefineMessages(args: RefinePromptArgs): PromptMessage[] {
  return [
    {
      role: "system",
      content: [
        `You are in refine layer ${args.layer}.`,
        "Incorporate strong ideas from peers, explicitly reject weak ideas, and fill gaps.",
        `Focus override: ${args.focus}.`,
        "Return concise markdown with concrete implementation guidance."
      ].join("\n")
    },
    {
      role: "user",
      content: [
        buildTaskBlock(args),
        "Peer outputs:",
        formatStageOutputs(args.priorOutputs)
      ].join("\n\n")
    }
  ];
}

export function buildSynthesisMessages(args: SynthesisPromptArgs): PromptMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are the final synthesizer.",
        "Produce markdown with EXACTLY these section headers:",
        "## Agreements",
        "## Disagreements",
        "## Tech Stack",
        "## Implementation Steps",
        "## Risks"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        buildTaskBlock(args),
        "Refined model outputs:",
        formatStageOutputs(args.priorOutputs)
      ].join("\n\n")
    }
  ];
}

function buildTaskBlock(args: PromptBaseArgs): string {
  return [
    `Task: ${args.task}`,
    args.context ? `Context:\n${args.context}` : undefined,
    `Requested focus: ${args.focus}`
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

function formatStageOutputs(outputs: StageOutput[]): string {
  if (outputs.length === 0) {
    return "(none)";
  }

  return outputs
    .map((output) =>
      [`### ${output.providerId} (${output.model})`, output.content.trim()].join("\n")
    )
    .join("\n\n");
}
