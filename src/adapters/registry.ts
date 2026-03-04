import type { CollabConfig, SubscriptionAdapterConfig } from "../types/index.js";
import { commandExists } from "../utils/exec.js";

export class AdapterRegistry {
  private readonly adaptersByName = new Map<string, SubscriptionAdapterConfig>();

  constructor(config: CollabConfig) {
    for (const adapter of config.subscriptionAdapters) {
      if (adapter.enabled === false) {
        continue;
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

  async diagnostics(): Promise<
    Array<{ name: string; command: string; available: boolean }>
  > {
    const results: Array<{ name: string; command: string; available: boolean }> = [];

    for (const adapter of this.adaptersByName.values()) {
      // eslint-disable-next-line no-await-in-loop
      const available = await commandExists(adapter.command);
      results.push({
        name: adapter.name,
        command: adapter.command,
        available
      });
    }

    return results;
  }
}
