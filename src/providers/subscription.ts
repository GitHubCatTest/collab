import {
  runSubscriptionAdapter,
  SubscriptionAdapterError
} from "../adapters/subscription.js";
import { BaseProvider } from "./base.js";
import {
  ProviderRequestError,
  classifyUnknownError,
  type ProviderErrorCode
} from "./errors.js";
import { estimateTokenCostUsd } from "../pricing.js";
import type {
  ProviderClient,
  ProviderCompletion,
  ProviderMessage,
  ProviderRuntimeConfig
} from "./types.js";

export class SubscriptionProvider extends BaseProvider implements ProviderClient {
  constructor(runtimeConfig: ProviderRuntimeConfig) {
    super(runtimeConfig.provider, runtimeConfig);
  }

  async complete(
    messages: ProviderMessage[],
    options?: { maxOutputTokens?: number }
  ): Promise<ProviderCompletion> {
    const runtime = this.getRuntimeConfig();
    const model = this.getModel(undefined, runtime.model);
    const maxOutputTokens = this.getMaxOutputTokens(options?.maxOutputTokens, runtime);
    const adapter = runtime.subscription;

    if (!adapter?.command) {
      throw new ProviderRequestError({
        message: `${runtime.provider} subscription transport requires adapter command`,
        code: "invalid_request",
        retryable: false
      });
    }

    try {
      const result = await runSubscriptionAdapter({
        provider: runtime.provider,
        model,
        messages,
        maxOutputTokens,
        adapter: {
          command: adapter.command,
          args: adapter.args ?? [],
          timeoutMs: adapter.timeoutMs
        }
      });

      const completion = this.asCompletion({
        content: result.content.trim() || "No response body",
        model,
        promptText: messages.map((message) => message.content).join("\n\n")
      });

      if (result.tokens) {
        completion.tokens = {
          input: result.tokens.input,
          output: result.tokens.output
        };
        completion.estimatedCostUsd = estimateTokenCostUsd(
          completion.tokens.input,
          completion.tokens.output
        );
      }

      return completion;
    } catch (error) {
      if (error instanceof ProviderRequestError) {
        throw error;
      }

      if (error instanceof SubscriptionAdapterError) {
        const mapped = mapAdapterError(error);
        throw new ProviderRequestError({
          message: `${runtime.provider} subscription adapter failed: ${error.message}`,
          code: mapped.code,
          retryable: mapped.retryable
        });
      }

      const classified = classifyUnknownError(error);
      throw new ProviderRequestError({
        message: classified.message,
        code: classified.code,
        retryable: classified.retryable
      });
    }
  }
}

function mapAdapterError(error: SubscriptionAdapterError): {
  code: ProviderErrorCode;
  retryable: boolean;
} {
  if (error.code === "timeout") {
    return {
      code: "timeout",
      retryable: true
    };
  }

  if (error.code === "non-zero-exit") {
    return {
      code: "provider_unavailable",
      retryable: true
    };
  }

  return {
    code: "invalid_request",
    retryable: false
  };
}
