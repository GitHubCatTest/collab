import assert from "node:assert/strict"
import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import process from "node:process"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const SYNTHESIS_MARKDOWN = [
  "## Agreements",
  "- Recommendation: Option A",
  "- Rationale: Lowest delivery risk and best migration path.",
  "",
  "## Disagreements",
  "- Option A vs Option B trade-off remains around initial setup complexity.",
  "",
  "## Tech Stack",
  "- API: Fastify",
  "- Queue: SQS",
  "",
  "## Implementation Steps",
  "1. Create feature-flagged rollout path",
  "2. Add health checks and smoke automation",
  "",
  "## Risks",
  "- Rollout regressions without canary metrics"
].join("\n")

interface SmokeCheck {
  name: string
  ok: boolean
  detail: string
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function buildFetchMockSource(): string {
  const markdown = JSON.stringify(SYNTHESIS_MARKDOWN)

  return `
const markdown = ${markdown};

globalThis.fetch = async (input) => {
  const target =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  const jsonHeaders = { "content-type": "application/json" };

  if (target.includes("openai.com")) {
    return new Response(JSON.stringify({ output_text: markdown }), {
      status: 200,
      headers: jsonHeaders
    });
  }

  if (target.includes("anthropic.com")) {
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: markdown }] }),
      {
        status: 200,
        headers: jsonHeaders
      }
    );
  }

  if (target.includes("generativelanguage.googleapis.com")) {
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: markdown }] } }]
      }),
      {
        status: 200,
        headers: jsonHeaders
      }
    );
  }

  throw new Error(\`Unexpected URL in smoke fetch mock: \${target}\`);
};
`
}

function getTextContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const maybeContent = (result as { content?: unknown }).content
  if (!Array.isArray(maybeContent)) {
    return ""
  }

  const firstText = maybeContent.find((entry) => {
    if (!entry || typeof entry !== "object") {
      return false
    }

    const candidate = entry as { type?: unknown; text?: unknown }
    return candidate.type === "text" && typeof candidate.text === "string"
  }) as { text?: string } | undefined

  return firstText?.text ?? ""
}

function printCheck(check: SmokeCheck): void {
  const status = check.ok ? "PASS" : "FAIL"
  console.log(`${status} ${check.name}: ${check.detail}`)
}

async function main(): Promise<number> {
  const checks: SmokeCheck[] = []
  const serverPath = resolve(process.cwd(), "dist/src/index.js")

  try {
    await access(serverPath)
  } catch {
    checks.push({
      name: "server build artifact",
      ok: false,
      detail: `missing ${serverPath}`
    })
    checks.forEach(printCheck)
    console.log(`Summary: 0 passed, ${checks.length} failed`)
    return 1
  }

  const tempDir = await mkdtemp(join(tmpdir(), "collab-mcp-smoke-"))
  const mockModulePath = join(tempDir, "mock-fetch.mjs")
  await writeFile(mockModulePath, buildFetchMockSource(), "utf8")

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", mockModulePath, serverPath],
    cwd: process.cwd(),
    env: {
      OPENAI_API_KEY: "smoke-openai",
      ANTHROPIC_API_KEY: "smoke-anthropic",
      GOOGLE_API_KEY: "smoke-google"
    },
    stderr: "pipe"
  })

  const stderrBuffer: string[] = []
  const stderrStream = transport.stderr
  if (stderrStream) {
    stderrStream.on("data", (chunk) => {
      if (stderrBuffer.length >= 20) {
        return
      }
      stderrBuffer.push(String(chunk).trim())
    })
  }

  const client = new Client(
    {
      name: "collab-mcp-smoke-client",
      version: "1.0.0"
    },
    {
      capabilities: {}
    }
  )

  try {
    await client.connect(transport)

    try {
      const toolsResult = await client.listTools()
      const names = toolsResult.tools.map((tool) => tool.name).sort()
      assert.deepEqual(names, ["compare", "plan", "review"])
      checks.push({
        name: "tools/list",
        ok: true,
        detail: names.join(", ")
      })
    } catch (error) {
      checks.push({
        name: "tools/list",
        ok: false,
        detail: toErrorMessage(error)
      })
    }

    try {
      const planResult = await client.callTool({
        name: "plan",
        arguments: {
          task: "Smoke test plan generation",
          layers: 1,
          providers: ["openai", "anthropic"],
          synthesizer: "anthropic"
        }
      })
      assert.ok(!("isError" in planResult) || !planResult.isError)
      const text = getTextContent(planResult)
      assert.ok(text.includes("agreements"))
      checks.push({
        name: "tools/call plan",
        ok: true,
        detail: "returned structured plan"
      })
    } catch (error) {
      checks.push({
        name: "tools/call plan",
        ok: false,
        detail: toErrorMessage(error)
      })
    }

    try {
      const compareResult = await client.callTool({
        name: "compare",
        arguments: {
          decision: "Pick queue backend",
          options: ["Option A", "Option B"],
          layers: 1,
          providers: ["openai", "anthropic"],
          synthesizer: "anthropic"
        }
      })
      assert.ok(!("isError" in compareResult) || !compareResult.isError)
      const structuredContent = (compareResult as { structuredContent?: unknown })
        .structuredContent
      assert.ok(structuredContent && typeof structuredContent === "object")
      const recommendation = (structuredContent as Record<string, unknown>).recommendation
      assert.equal(typeof recommendation, "string")
      checks.push({
        name: "tools/call compare",
        ok: true,
        detail: "returned recommendation"
      })
    } catch (error) {
      checks.push({
        name: "tools/call compare",
        ok: false,
        detail: toErrorMessage(error)
      })
    }

    try {
      const reviewResult = await client.callTool({
        name: "review",
        arguments: {
          plan: "1. Build feature\n2. Roll out safely",
          layers: 1,
          providers: ["openai", "anthropic"],
          synthesizer: "anthropic"
        }
      })
      assert.ok(!("isError" in reviewResult) || !reviewResult.isError)
      const text = getTextContent(reviewResult)
      assert.ok(text.includes("review"))
      checks.push({
        name: "tools/call review",
        ok: true,
        detail: "returned review output"
      })
    } catch (error) {
      checks.push({
        name: "tools/call review",
        ok: false,
        detail: toErrorMessage(error)
      })
    }
  } finally {
    try {
      await client.close()
    } catch {
      // No-op.
    }

    await rm(tempDir, { recursive: true, force: true })
  }

  const failed = checks.filter((check) => !check.ok)
  const passed = checks.length - failed.length

  checks.forEach(printCheck)
  if (failed.length > 0 && stderrBuffer.length > 0) {
    const stderrPreview = stderrBuffer.filter(Boolean).join(" | ")
    console.error(`Server stderr: ${stderrPreview}`)
  }
  console.log(`Summary: ${passed} passed, ${failed.length} failed`)

  return failed.length > 0 ? 1 : 0
}

main()
  .then((code) => {
    if (code !== 0) {
      process.exitCode = code
    }
  })
  .catch((error) => {
    console.error(`FAIL smoke runner: ${toErrorMessage(error)}`)
    process.exitCode = 1
  })
