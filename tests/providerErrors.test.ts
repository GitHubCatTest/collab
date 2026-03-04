import test from "node:test";
import assert from "node:assert/strict";
import {
  ProviderRequestError,
  classifyHttpError,
  classifyUnknownError
} from "../src/providers/errors.js";

test("classifyHttpError maps common statuses", () => {
  assert.deepEqual(classifyHttpError(401), { code: "auth", retryable: false });
  assert.deepEqual(classifyHttpError(429), {
    code: "rate_limit",
    retryable: true
  });
  assert.deepEqual(classifyHttpError(500), {
    code: "provider_unavailable",
    retryable: true
  });
});

test("classifyUnknownError handles abort/timeouts", () => {
  const abortLike = { name: "AbortError" } as Error;
  const result = classifyUnknownError(abortLike);
  assert.equal(result.code, "timeout");
  assert.equal(result.retryable, true);
});

test("ProviderRequestError preserves metadata", () => {
  const error = new ProviderRequestError({
    message: "boom",
    code: "network",
    retryable: true,
    status: 503,
    responseBody: "unavailable"
  });

  assert.equal(error.code, "network");
  assert.equal(error.retryable, true);
  assert.equal(error.status, 503);
  assert.equal(error.responseBody, "unavailable");
});
