import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { AdapterRegistry } from "../adapters/registry.js";

export async function listAdaptersCommand(repoPathArg?: string): Promise<number> {
  const repoPath = resolve(repoPathArg ?? process.cwd());
  const { config } = await loadConfig({
    cwd: repoPath,
    cli: {}
  });

  const registry = new AdapterRegistry(config);
  const diagnostics = await registry.diagnostics();

  if (diagnostics.length === 0) {
    console.log("No subscription adapters configured.");
    return 0;
  }

  console.log("Configured subscription adapters:");
  for (const adapter of diagnostics) {
    console.log(
      `- ${adapter.name}: command=${adapter.command} status=${
        adapter.available ? "available" : "not-found"
      }`
    );
  }

  return 0;
}
