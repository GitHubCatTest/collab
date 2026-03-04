# Security and Privacy Policy

## Core Rules

1. Do not commit API keys, tokens, or local credential files.
2. Telemetry is disabled by default and must be explicitly enabled.
3. Session logs and artifacts must pass redaction before writing.
4. No browser automation or scraping of web subscriptions in core CLI.

## Auth and Provider Policy

- Official API adapters use user-provided API keys via environment variables.
- Subscription usage is allowed only through user-installed, explicitly configured CLI adapters.
- `collab` does not extract or exfiltrate auth cookies, OAuth tokens, or browser session data.
- Users are responsible for complying with provider terms when configuring adapters.

## Secret Handling

- Redact sensitive token patterns in logs and event output.
- Do not print raw env var values in diagnostics.
- Treat provider responses as untrusted data and redact before persistence.

## Open Source Hygiene

- Keep all repository docs/examples free of real credentials.
- Use placeholders like `OPENAI_API_KEY=...` in samples.
- Review PRs for accidental secrets before merge.
