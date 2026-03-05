import test from "node:test";
import assert from "node:assert/strict";
import { BaseProvider, type JsonRequestArgs } from "../src/providers/base.js";
import { ProviderRequestError } from "../src/providers/errors.js";

class TestProvider extends BaseProvider {
  constructor() {
    super("openai");
  }

  async complete() {
    return {
      content: "unused",
      model: "test-model",
      estimatedCostUsd: 0
    };
  }

  async request<T>(args: JsonRequestArgs): Promise<T> {
    return this.jsonRequest<T>(args);
  }
}

async function withMockedFetch(
  mockFetch: typeof fetch,
  fn: () => Promise<void>
): Promise<void> {
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = mockFetch;

  try {
    await fn();
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
}

test("jsonRequest retries transient 429 responses", async () => {
  const provider = new TestProvider();
  let attempts = 0;

  await withMockedFetch(
    (async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response("rate limited", { status: 429 });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }) as typeof fetch,
    async () => {
      const response = await provider.request<{ ok: boolean }>({
        url: "https://example.test/ratelimit",
        timeoutMs: 100,
        maxRetries: 2,
        retryBaseDelayMs: 0,
        retryJitterMs: 0,
        retryMaxDelayMs: 0
      });

      assert.deepEqual(response, { ok: true });
      assert.equal(attempts, 3);
    }
  );
});

test("jsonRequest does not retry non-retryable 401 responses", async () => {
  const provider = new TestProvider();
  let attempts = 0;

  await withMockedFetch(
    (async () => {
      attempts += 1;
      return new Response("unauthorized", { status: 401 });
    }) as typeof fetch,
    async () => {
      await assert.rejects(
        () =>
          provider.request({
            url: "https://example.test/auth",
            timeoutMs: 100,
            maxRetries: 3,
            retryBaseDelayMs: 0,
            retryJitterMs: 0,
            retryMaxDelayMs: 0
          }),
        (error: unknown) => {
          assert.ok(error instanceof ProviderRequestError);
          assert.equal(error.code, "auth");
          assert.equal(error.retryable, false);
          return true;
        }
      );

      assert.equal(attempts, 1);
    }
  );
});

test("jsonRequest retries transient network failures", async () => {
  const provider = new TestProvider();
  let attempts = 0;

  await withMockedFetch(
    (async () => {
      attempts += 1;
      if (attempts === 1) {
        const networkError = new Error("connection reset") as Error & {
          code?: string;
        };
        networkError.code = "ECONNRESET";
        throw networkError;
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }) as typeof fetch,
    async () => {
      const response = await provider.request<{ ok: boolean }>({
        url: "https://example.test/network",
        timeoutMs: 100,
        maxRetries: 1,
        retryBaseDelayMs: 0,
        retryJitterMs: 0,
        retryMaxDelayMs: 0
      });

      assert.deepEqual(response, { ok: true });
      assert.equal(attempts, 2);
    }
  );
});

test("jsonRequest classifies aborts as timeout errors", async () => {
  const provider = new TestProvider();

  await withMockedFetch(
    ((_: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }

        signal.addEventListener(
          "abort",
          () => {
            const abortError = new Error("aborted") as Error & { name: string };
            abortError.name = "AbortError";
            reject(abortError);
          },
          { once: true }
        );
      });
    }) as typeof fetch,
    async () => {
      await assert.rejects(
        () =>
          provider.request({
            url: "https://example.test/timeout",
            timeoutMs: 10,
            maxRetries: 0,
            retryBaseDelayMs: 0,
            retryJitterMs: 0,
            retryMaxDelayMs: 0
          }),
        (error: unknown) => {
          assert.ok(error instanceof ProviderRequestError);
          assert.equal(error.code, "timeout");
          assert.equal(error.retryable, true);
          return true;
        }
      );
    }
  );
});

test("jsonRequest classifies 5xx as provider_unavailable", async () => {
  const provider = new TestProvider();
  let attempts = 0;

  await withMockedFetch(
    (async () => {
      attempts += 1;
      return new Response("upstream unavailable", { status: 503 });
    }) as typeof fetch,
    async () => {
      await assert.rejects(
        () =>
          provider.request({
            url: "https://example.test/upstream",
            timeoutMs: 100,
            maxRetries: 1,
            retryBaseDelayMs: 0,
            retryJitterMs: 0,
            retryMaxDelayMs: 0
          }),
        (error: unknown) => {
          assert.ok(error instanceof ProviderRequestError);
          assert.equal(error.code, "provider_unavailable");
          assert.equal(error.retryable, true);
          assert.equal(error.status, 503);
          return true;
        }
      );

      assert.equal(attempts, 2);
    }
  );
});
