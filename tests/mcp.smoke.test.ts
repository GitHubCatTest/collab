import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CollabMcpConfig } from "../src/config.js"
import { createServer } from "../src/server.js"

const SYNTHESIS_MARKDOWN = [
  "## Agreements",
  "- Recommendation: Option A",
  "- Rationale: Better reliability under expected load.",
  "",
  "## Disagreements",
  "- Option A vs Option B remains a trade-off around setup complexity.",
  "",
  "## Tech Stack",
  "- Queue: SQS",
  "",
  "## Implementation Steps",
  "1. Add migration guardrails",
  "2. Add rollout smoke tests",
  "",
  "## Risks",
  "- Rollback delays if alerting is incomplete"
].join("\n")

function buildTestConfig(): CollabMcpConfig {
  return {
    defaultLayers: 1,
    maxLayers: 4,
    timeoutMs: 1000,
    maxOutputTokens: 600,
    defaultSynthesizer: "anthropic",
    providers: {
      openai: {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKeyEnv: "OPENAI_API_KEY",
        baseUrl: "https://api.openai.com/v1/responses",
        timeoutMs: 1000,
        maxOutputTokens: 600,
        available: true
      },
      anthropic: {
        provider: "anthropic",
        model: "claude-3-5-haiku-latest",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        baseUrl: "https://api.anthropic.com/v1/messages",
        timeoutMs: 1000,
        maxOutputTokens: 600,
        available: true
      },
      google: {
        provider: "google",
        model: "gemini-2.0-flash",
        apiKeyEnv: "GOOGLE_API_KEY",
        baseUrl:
          "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        timeoutMs: 1000,
        maxOutputTokens: 600,
        available: false
      }
    }
  }
}

test(
  "MCP handshake lists tools and executes compare with mocked fetch",
  { timeout: 4000 },
  async () => {
    const originalFetch = globalThis.fetch
    const originalEnv = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
    }

    let callCount = 0

    process.env.OPENAI_API_KEY = "test-openai"
    process.env.ANTHROPIC_API_KEY = "test-anthropic"

    globalThis.fetch = (async (input: string | URL) => {
      callCount += 1
      const target = String(input)

      if (target.includes("openai.com")) {
        return new Response(JSON.stringify({ output_text: SYNTHESIS_MARKDOWN }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      }

      if (target.includes("anthropic.com")) {
        return new Response(
          JSON.stringify({ content: [{ type: "text", text: SYNTHESIS_MARKDOWN }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      }

      throw new Error(`Unexpected URL in mcp smoke test: ${target}`)
    }) as typeof fetch

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createServer({ config: buildTestConfig() })
    const client = new Client(
      {
        name: "mcp-smoke-test-client",
        version: "1.0.0"
      },
      {
        capabilities: {}
      }
    )

    try {
      await server.connect(serverTransport)
      await client.connect(clientTransport)

      const serverVersion = client.getServerVersion()
      assert.equal(serverVersion?.name, "collab-mcp")

      const tools = await client.listTools()
      const names = tools.tools.map((tool) => tool.name).sort()
      assert.deepEqual(names, ["compare", "plan", "review"])

      const result = await client.callTool({
        name: "compare",
        arguments: {
          decision: "Select queue backend",
          options: ["Option A", "Option B"],
          layers: 1,
          providers: ["openai", "anthropic"],
          synthesizer: "anthropic"
        }
      })

      assert.ok(!("isError" in result) || !result.isError)
      assert.ok("structuredContent" in result && result.structuredContent)
      assert.equal(
        (result.structuredContent as { recommendation?: string }).recommendation,
        "Option A"
      )

      // 2 providers, 1 layer => seed(2) + refine(2) + synth(1) = 5 calls.
      assert.equal(callCount, 5)
    } finally {
      await client.close()
      globalThis.fetch = originalFetch

      if (originalEnv.OPENAI_API_KEY === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY
      }

      if (originalEnv.ANTHROPIC_API_KEY === undefined) {
        delete process.env.ANTHROPIC_API_KEY
      } else {
        process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY
      }
    }
  }
)
