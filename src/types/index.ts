export type AgentRole = "architect" | "implementer" | "reviewer" | "arbiter";
export type ExecutionMode = "plan" | "patch" | "apply";
export type VerificationProfile = "none" | "basic" | "strict";
export type TeamMode = "manual" | "auto";
export type TeamRoleStrategy = "strengths_first" | "fixed";
export type SessionState =
  | "init"
  | "planning"
  | "patching"
  | "verifying"
  | "ready_to_apply"
  | "applying"
  | "completed"
  | "failed";

export const AGENT_ROLES: AgentRole[] = [
  "architect",
  "implementer",
  "reviewer",
  "arbiter"
];

export type ProviderName = "openrouter" | "anthropic" | "google" | "openai";

export interface RoleAssignment {
  provider: ProviderName | "adapter";
  model: string;
  adapter?: string;
}

export interface ProviderConfig {
  apiKeyEnv: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface SubscriptionAdapterConfig {
  name: string;
  command: string;
  args?: string[];
  outputFormat?: "sections" | "json";
  payloadMode?: "stdin" | "env";
  inheritEnv?: boolean;
  passEnv?: string[];
  testArgs?: string[];
  healthCheckArgs?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface LimitsConfig {
  maxRounds: number;
  budgetUsd: number;
  timeoutSec: number;
}

export interface ExecutionConfig {
  mode: ExecutionMode;
  maxRevisionLoops: number;
  requireApplyConfirmation: boolean;
  parallelPeerRoles: boolean;
  allowFallbackPatch: boolean;
}

export interface TeamConfig {
  mode: TeamMode;
  roleStrategy: TeamRoleStrategy;
  debateRounds: number;
}

export interface QualityConfig {
  requireEvidence: boolean;
  rejectUnknownFileRefs: boolean;
}

export interface VerificationConfig {
  profile: VerificationProfile;
  commands: string[];
}

export interface TelemetryConfig {
  enabled: boolean;
  endpoint?: string;
}

export interface CollabConfig {
  roles: Record<AgentRole, RoleAssignment>;
  providers: Partial<Record<ProviderName, ProviderConfig>>;
  subscriptionAdapters: SubscriptionAdapterConfig[];
  limits: LimitsConfig;
  execution: ExecutionConfig;
  team: TeamConfig;
  quality: QualityConfig;
  verification: VerificationConfig;
  telemetry: TelemetryConfig;
  outputDir?: string;
}

export interface RunCliOptions {
  repoPath?: string;
  maxRounds?: number;
  budgetUsd?: number;
  timeoutSec?: number;
  mode?: ExecutionMode;
  verify?: VerificationProfile;
  teamMode?: TeamMode;
  debateRounds?: number;
  requireEvidence?: boolean;
  allowFallbackPatch?: boolean;
  maxRevisionLoops?: number;
  autoYes?: boolean;
  outDir?: string;
  json?: boolean;
}

export interface GenerateInput {
  role: AgentRole;
  task: string;
  round: number;
  boardSummary: string;
  priorMessages: BusEvent[];
  timeoutMs: number;
}

export interface GenerateResult {
  text: string;
  provider: ProviderName | "adapter";
  model: string;
  latencyMs: number;
  estimatedCostUsd: number;
}

export interface Proposal {
  id: string;
  round: number;
  authorRole: Exclude<AgentRole, "arbiter">;
  summary: string;
  diffPlan: string;
  risks: string[];
  tests: string[];
  evidence: string[];
  rawText: string;
}

export interface ProposalScores {
  alignment: number;
  feasibility: number;
  safety: number;
  testability: number;
  efficiency: number;
  weightedTotal: number;
}

export interface ArbiterDecision {
  winnerId: string;
  scores: Record<string, ProposalScores>;
  rationale: string;
  alternatives: string[];
}

export interface BusEvent {
  id: string;
  ts: string;
  sessionId: string;
  round: number;
  role: AgentRole;
  type:
    | "role_response"
    | "proposal"
    | "arbiter_decision"
    | "system"
    | "warning"
    | "state_transition"
    | "verification"
    | "role_negotiation"
    | "disagreement_flag"
    | "evidence_check"
    | "adapter_health"
    | "quality_gate";
  content: string;
  refs?: string[];
  costUsd?: number;
}

export interface SessionArtifacts {
  finalPath: string;
  diffPath: string;
  logPath: string;
  summaryPath: string;
}

export interface SessionSummary {
  sessionId: string;
  task: string;
  roundsCompleted: number;
  sessionState: SessionState;
  mode: ExecutionMode;
  verificationProfile: VerificationProfile;
  verificationPassed: boolean;
  revisionAttempts: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  providersUsed: string[];
  winnerProposalId: string;
  patchSource?: CandidatePatch["source"];
  outputDir: string;
}

export interface OrchestrationResult {
  sessionId: string;
  proposals: Proposal[];
  winningProposal: Proposal;
  arbiterDecision: ArbiterDecision;
  events: BusEvent[];
  summary: SessionSummary;
}

export interface CandidatePatch {
  patch: string;
  source: "model" | "fallback";
  targetFiles: string[];
}

export interface VerificationCommandResult {
  command: string;
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface VerificationResult {
  profile: VerificationProfile;
  passed: boolean;
  commandResults: VerificationCommandResult[];
  summary: string;
}
