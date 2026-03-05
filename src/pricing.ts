export const INPUT_TOKEN_RATE_USD = 0.000001;
export const OUTPUT_TOKEN_RATE_USD = 0.000003;

export function estimateTokenCostUsd(inputTokens: number, outputTokens: number): number {
  return Number(
    (inputTokens * INPUT_TOKEN_RATE_USD + outputTokens * OUTPUT_TOKEN_RATE_USD).toFixed(6)
  );
}
