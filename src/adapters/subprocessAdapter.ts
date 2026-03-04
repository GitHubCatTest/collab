import { execFile } from "node:child_process";
import type {
  GenerateInput,
  GenerateResult,
  SubscriptionAdapterConfig
} from "../types/index.js";

export interface AdapterInvocation {
  adapter: SubscriptionAdapterConfig;
  model: string;
  input: GenerateInput;
}

export async function runSubprocessAdapter(
  invocation: AdapterInvocation
): Promise<GenerateResult> {
  const startMs = Date.now();

  const payload = JSON.stringify({
    model: invocation.model,
    role: invocation.input.role,
    round: invocation.input.round,
    task: invocation.input.task,
    boardSummary: invocation.input.boardSummary
  });

  const env = {
    ...process.env,
    COLLAB_ADAPTER_PAYLOAD: payload
  };

  const text = await new Promise<string>((resolve, reject) => {
    execFile(
      invocation.adapter.command,
      invocation.adapter.args ?? [],
      {
        timeout: invocation.input.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
        env
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `Adapter ${invocation.adapter.name} failed: ${(stderr || error.message).trim()}`
            )
          );
          return;
        }

        resolve(stdout.trim());
      }
    );
  });

  const latencyMs = Date.now() - startMs;

  return {
    text: text || "SUMMARY:\nAdapter returned empty output",
    provider: "adapter",
    model: invocation.model,
    latencyMs,
    estimatedCostUsd: 0
  };
}
