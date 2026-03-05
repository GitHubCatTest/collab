const REDACTION_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  {
    regex: /sk-[A-Za-z0-9]{20,}/g,
    replacement: "[REDACTED_OPENAI_KEY]"
  },
  {
    regex: /AIza[0-9A-Za-z\-_]{20,}/g,
    replacement: "[REDACTED_GOOGLE_KEY]"
  },
  {
    regex: /x-api-key\s*[:=]\s*["']?([A-Za-z0-9._\-]{16,})["']?/gi,
    replacement: "x-api-key=[REDACTED]"
  },
  {
    regex: /(authorization\s*[:=]\s*["']?Bearer\s+)[A-Za-z0-9._\-]+/gi,
    replacement: "$1[REDACTED]"
  },
  {
    regex: /(api[_-]?key\s*[:=]\s*["']?)[A-Za-z0-9._\-]{16,}/gi,
    replacement: "$1[REDACTED]"
  },
  {
    regex: /gh[pousr]_[A-Za-z0-9]{20,}/g,
    replacement: "[REDACTED_GITHUB_TOKEN]"
  },
  {
    regex: /xox[baprs]-[A-Za-z0-9-]{20,}/g,
    replacement: "[REDACTED_SLACK_TOKEN]"
  },
  {
    regex: /(?:token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9._\-]{12,}["']?/gi,
    replacement: "[REDACTED_SECRET]"
  }
];

export function redactSensitiveText(input: string): string {
  let output = sanitizeTerminalText(input);
  for (const pattern of REDACTION_PATTERNS) {
    output = output.replace(pattern.regex, pattern.replacement);
  }

  return output;
}

export function redactEnvValue(value: string | undefined): string {
  if (!value) {
    return "missing";
  }
  return "present";
}

export function redactUnknown(input: unknown): unknown {
  const seen = new WeakMap<object, unknown>();
  return redactUnknownInternal(input, seen);
}

function redactUnknownInternal(input: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof input === "string") {
    return redactSensitiveText(input);
  }

  if (Array.isArray(input)) {
    if (seen.has(input)) {
      return seen.get(input);
    }
    const out: unknown[] = [];
    seen.set(input, out);
    for (const item of input) {
      out.push(redactUnknownInternal(item, seen));
    }
    return out;
  }

  if (input && typeof input === "object") {
    const existing = seen.get(input);
    if (existing !== undefined) {
      return existing;
    }

    const out: Record<string, unknown> = {};
    seen.set(input, out);
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = redactUnknownInternal(value, seen);
    }
    return out;
  }

  return input;
}

export function sanitizeTerminalText(input: string): string {
  return stripControlChars(stripAnsi(input));
}

function stripAnsi(input: string): string {
  return input.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function stripControlChars(input: string): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}
