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
  }
];

export function redactSensitiveText(input: string): string {
  let output = input;
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
