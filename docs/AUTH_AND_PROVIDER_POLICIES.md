# Provider Auth and Subscription Policy Notes

This project supports API integrations directly and supports subscription usage only through explicit user-configured local adapters.

## Official API Paths (v0.1)

- OpenAI: Responses API (`POST /v1/responses`) with API key auth.
- Anthropic: Messages API (`POST /v1/messages`) with `x-api-key` header.
- Google: Gemini API (`generateContent`) with API key auth.
- OpenRouter: Chat Completions API with bearer token auth.

## Subscription Clarifications

- OpenAI confirms API billing is separate from ChatGPT subscription billing.
- Anthropic confirms Claude Pro/Max plan cost does not include API usage.
- Google Gemini subscriptions and Gemini API billing are separate product surfaces.

## Project Policy

- No scraping, browser automation, or token extraction from consumer web apps.
- Subscription usage must be explicit via local CLI adapters users install and authorize themselves.
- Users are responsible for complying with provider terms when enabling adapters.

## Sources

- OpenAI Help: https://help.openai.com/en/articles/8156019
- Anthropic Help: https://support.claude.com/en/articles/9797557-why-am-i-being-charged-more-than-my-claude-pro-or-max-plan-price
- Google Gemini Subscriptions: https://gemini.google/subscriptions/
- Gemini API key docs: https://ai.google.dev/gemini-api/docs/api-key
- OpenRouter docs: https://openrouter.ai/docs/quickstart
