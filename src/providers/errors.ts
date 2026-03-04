export type ProviderErrorCode =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "invalid_request"
  | "provider_unavailable"
  | "network"
  | "unknown";

export class ProviderRequestError extends Error {
  code: ProviderErrorCode;
  status?: number;
  responseBody?: string;
  retryable: boolean;

  constructor(args: {
    message: string;
    code: ProviderErrorCode;
    retryable: boolean;
    status?: number;
    responseBody?: string;
  }) {
    super(args.message);
    this.name = "ProviderRequestError";
    this.code = args.code;
    this.retryable = args.retryable;
    this.status = args.status;
    this.responseBody = args.responseBody;
  }
}

export function classifyHttpError(status: number): {
  code: ProviderErrorCode;
  retryable: boolean;
} {
  if (status === 401 || status === 403) {
    return { code: "auth", retryable: false };
  }

  if (status === 429) {
    return { code: "rate_limit", retryable: true };
  }

  if (status >= 400 && status < 500) {
    return { code: "invalid_request", retryable: false };
  }

  if (status >= 500) {
    return { code: "provider_unavailable", retryable: true };
  }

  return { code: "unknown", retryable: false };
}

export function classifyUnknownError(error: unknown): {
  code: ProviderErrorCode;
  retryable: boolean;
  message: string;
} {
  const typed = error as NodeJS.ErrnoException;

  if (typed?.name === "AbortError") {
    return {
      code: "timeout",
      retryable: true,
      message: "Provider request timed out"
    };
  }

  if (
    typed?.code === "ENOTFOUND" ||
    typed?.code === "ECONNRESET" ||
    typed?.code === "ECONNREFUSED" ||
    typed?.code === "ETIMEDOUT"
  ) {
    return {
      code: "network",
      retryable: true,
      message: `Network error: ${typed.code}`
    };
  }

  return {
    code: "unknown",
    retryable: false,
    message: error instanceof Error ? error.message : String(error)
  };
}
