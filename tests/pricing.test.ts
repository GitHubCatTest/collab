import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokenCostUsd,
  INPUT_TOKEN_RATE_USD,
  OUTPUT_TOKEN_RATE_USD
} from "../src/pricing.js";

test("estimateTokenCostUsd computes token pricing with project rates", () => {
  const inputTokens = 350;
  const outputTokens = 840;
  const expected = Number(
    (inputTokens * INPUT_TOKEN_RATE_USD + outputTokens * OUTPUT_TOKEN_RATE_USD).toFixed(6)
  );

  assert.equal(estimateTokenCostUsd(inputTokens, outputTokens), expected);
});

test("estimateTokenCostUsd rounds to six decimals", () => {
  assert.equal(estimateTokenCostUsd(1, 1), 0.000004);
});
