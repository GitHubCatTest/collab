# Session Event Schema (NDJSON)

`collab` writes session traces to `session.ndjson` as one JSON object per line.

## Top-level fields

- `id` (string): unique event id.
- `ts` (string): ISO timestamp.
- `sessionId` (string): session correlation id.
- `round` (number): orchestration round index.
- `role` (`architect|implementer|reviewer|arbiter`): event author role.
- `type` (string): event category.
- `content` (string): human-readable event payload.
- `refs` (string[], optional): related proposal/event ids.
- `costUsd` (number, optional): estimated provider call cost.

## Event types

- `system`: lifecycle/system notes.
- `role_response`: raw model/adapter role output.
- `proposal`: parsed proposal summary from a role response.
- `arbiter_decision`: winner selection and rationale.
- `warning`: degraded behavior, provider errors, budget/time warnings.
- `state_transition`: run state changes (`planning`, `patching`, `verifying`, etc.).
- `verification`: verification summary and quality-gate outcomes.
- `role_negotiation`: round-0 strengths declarations and mapping decisions when team mode is enabled.
- `disagreement_flag`: emitted when top proposal scores are very close and tie-break signaling is recorded.
- `evidence_check`: per-proposal evidence/ref analysis used by quality gating.
- `adapter_health`: adapter availability/degraded-health events for adapter-backed roles.
- `quality_gate`: final quality gate decision notes, including winner overrides when configured.

## Example line

```json
{
  "id": "3ef9d227-2bd0-4a38-b4ea-ccf118c7f634",
  "ts": "2026-03-04T22:06:40.015Z",
  "sessionId": "24ae2df8-3f9b-471b-8db9-bbd8f4d8cb09",
  "round": 1,
  "role": "arbiter",
  "type": "state_transition",
  "content": "verifying: Verification passed (3/3 commands)."
}
```

## Replay usage

Use `collab replay <session.ndjson>` to render ordered events plus summary stats:

- total events
- rounds encountered
- event counts by type and role
- warning count
- estimated cost from event stream
