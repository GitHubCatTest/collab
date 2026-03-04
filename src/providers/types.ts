import type {
  GenerateInput,
  GenerateResult,
  ProviderConfig,
  ProviderName,
  RoleAssignment
} from "../types/index.js";

export interface ProviderInvocation {
  assignment: RoleAssignment;
  config: ProviderConfig;
  input: GenerateInput;
}

export interface ProviderClient {
  name: ProviderName;
  isConfigured(config: ProviderConfig): boolean;
  generate(invocation: ProviderInvocation): Promise<GenerateResult>;
}
