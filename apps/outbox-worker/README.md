# Outbox worker

Relays rows from `ops.outbox_events` to a publish transport (ADR-012; DM-023).

## Local / development

| `OUTBOX_TRANSPORT` | Behavior |
| --- | --- |
| `local-memory` (default) | Claims rows as `dm_outbox_worker`, records envelopes in-process, marks outbox `published`. Sufficient for local durable semantics: the outbox table is authoritative until EventBridge exists. |
| `eventbridge` | Placeholder that refuses until DM-007 wires AWS EventBridge + SQS. |

Claim uses `FOR UPDATE SKIP LOCKED`, bounded retries, `dead_letter` on exhaustion, and `replayOutboxEvent` for operator replay. Correlation/causation IDs are preserved on the event envelope.

Inbox consumers (workers) use `@deutsch-mate/database` `consumeInboxMessage` so duplicate deliveries yield one effect.

## Production

Production must use EventBridge (`PutEvents`) with SQS consumers (DM-007). The claim/mark/DLQ loop in this app stays the same; only the `EventPublisher` adapter changes.
