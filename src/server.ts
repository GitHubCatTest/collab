import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfigFromEnv, type CollabMcpConfig } from "./config.js";
import {
  runCompareTool,
  compareToolInputSchema,
  type CompareToolResult
} from "./tools/compare.js";
import {
  runPlanTool,
  planToolInputSchema,
  type PlanToolResult
} from "./tools/plan.js";
import {
  runReviewTool,
  reviewToolInputSchema,
  type ReviewToolResult
} from "./tools/review.js";

export interface CreateServerOptions {
  config?: CollabMcpConfig;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const config = options.config ?? loadConfigFromEnv();
  const server = new McpServer({
    name: "collab-mcp",
    version: "1.0.0"
  });

  server.registerTool(
    "plan",
    {
      title: "Collaborative Plan",
      description:
        "Run a multi-model Mixture-of-Agents planning pipeline and return a structured implementation plan.",
      inputSchema: planToolInputSchema
    },
    async (args) => {
      const result = await runPlanTool(args, {
        config,
        onProgress: (message) =>
          server.sendLoggingMessage({
            level: "info",
            data: message,
            logger: "collab-mcp"
          })
      });

      return toToolResult(result);
    }
  );

  server.registerTool(
    "compare",
    {
      title: "Compare Options",
      description:
        "Ask multiple models to compare options and recommend a direction.",
      inputSchema: compareToolInputSchema
    },
    async (args) => {
      const result = await runCompareTool(args, {
        config,
        onProgress: (message) =>
          server.sendLoggingMessage({
            level: "info",
            data: message,
            logger: "collab-mcp"
          })
      });

      return toToolResult(result);
    }
  );

  server.registerTool(
    "review",
    {
      title: "Review Plan",
      description:
        "Critique an existing plan with multi-model feedback and risk analysis.",
      inputSchema: reviewToolInputSchema
    },
    async (args) => {
      const result = await runReviewTool(args, {
        config,
        onProgress: (message) =>
          server.sendLoggingMessage({
            level: "info",
            data: message,
            logger: "collab-mcp"
          })
      });

      return toToolResult(result);
    }
  );

  return server;
}

function toToolResult(result: PlanToolResult | CompareToolResult | ReviewToolResult) {
  const structuredContent = JSON.parse(
    JSON.stringify(result)
  ) as Record<string, unknown>;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2)
      }
    ],
    structuredContent
  };
}

export const toolSchemas = {
  plan: planToolInputSchema,
  compare: compareToolInputSchema,
  review: reviewToolInputSchema
} satisfies Record<string, z.ZodTypeAny>;
