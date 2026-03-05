import type { CollabConfig, SubscriptionAdapterConfig } from "../types/index.js";
import { commandExists } from "../utils/exec.js";

export interface AdapterDiagnostic {
  name: string;
  command: string;
  commandFound: boolean;
  outputFormat: "sections" | "json";
}

export class AdapterRegistry {
  private readonly adaptersByName = new Map<string, SubscriptionAdapterConfig>();

  constructor(config: CollabConfig) {
    for (const adapter of config.subscriptionAdapters) {
      if (adapter.enabled === false) {
        continue;
      }

      if (this.adaptersByName.has(adapter.name)) {
        throw new Error(`Duplicate subscription adapter name: ${adapter.name}`);
      }

      this.adaptersByName.set(adapter.name, adapter);
    }
  }

  get(name: string): SubscriptionAdapterConfig {
    const adapter = this.adaptersByName.get(name);
    if (!adapter) {
      throw new Error(`Unknown subscription adapter: ${name}`);
    }

    return adapter;
  }

  list(): SubscriptionAdapterConfig[] {
    return [...this.adaptersByName.values()];
  }

  async diagnostics(): Promise<AdapterDiagnostic[]> {
    const results: AdapterDiagnostic[] = [];

    for (const adapter of this.adaptersByName.values()) {
      // eslint-disable-next-line no-await-in-loop
      const commandFound = await commandExists(adapter.command);
      results.push({
        name: adapter.name,
        command: adapter.command,
        commandFound,
        outputFormat: adapter.outputFormat ?? "sections"
      });
    }

    return results;
  }
}
