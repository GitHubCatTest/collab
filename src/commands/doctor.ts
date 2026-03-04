import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { AdapterRegistry } from "../adapters/registry.js";
import { ProviderFactory } from "../providers/factory.js";
import { redactEnvValue } from "../safety/redaction.js";

export async function doctorCommand(repoPathArg?: string): Promise<number> {
  const repoPath = resolve(repoPathArg ?? process.cwd());
  const { config, loadedFiles } = await loadConfig({
    cwd: repoPath,
    cli: {}
  });

  console.log("Collab Doctor");
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Repo path: ${repoPath}`);
  console.log(
    loadedFiles.length > 0
      ? `Config files: ${loadedFiles.join(", ")}`
      : "Config files: none (defaults)"
  );
  console.log("");

  console.log("Providers:");
  const providerFactory = new ProviderFactory();
  for (const provider of providerFactory.list()) {
    const providerConfig = config.providers[provider.name];
    if (!providerConfig) {
      console.log(`- ${provider.name}: missing provider config`);
      continue;
    }

    const value = process.env[providerConfig.apiKeyEnv];
    const configured = provider.isConfigured(providerConfig);
    console.log(
      `- ${provider.name}: ${configured ? "configured" : "missing"} (env ${
        providerConfig.apiKeyEnv
      }=${redactEnvValue(value)})`
    );
  }

  console.log("");
  console.log("Role assignments:");
  for (const [role, assignment] of Object.entries(config.roles)) {
    const source =
      assignment.provider === "adapter"
        ? `adapter:${assignment.adapter ?? "<missing>"}`
        : assignment.provider;
    console.log(`- ${role}: ${source} / ${assignment.model}`);
  }

  console.log("");
  console.log("Subscription adapters:");
  const registry = new AdapterRegistry(config);
  const adapters = await registry.diagnostics();
  if (adapters.length === 0) {
    console.log("- none configured");
  } else {
    for (const adapter of adapters) {
      console.log(
        `- ${adapter.name}: command=${adapter.command} status=${
          adapter.available ? "available" : "not-found"
        }`
      );
    }
  }

  console.log("");
  console.log("Telemetry:");
  console.log(`- enabled: ${config.telemetry.enabled}`);
  if (config.telemetry.endpoint) {
    console.log(`- endpoint: ${config.telemetry.endpoint}`);
  }

  return 0;
}
