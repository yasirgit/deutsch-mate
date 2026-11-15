/**
 * Event publisher port for the outbox worker (ADR-012).
 *
 * Production: EventBridge PutEvents (DM-007). Local/dev: in-memory or no-op
 * durable semantics — the outbox row itself is the system of record until
 * EventBridge is wired; consumers are tested via inbox claim helpers.
 */

import type { DomainEventEnvelope } from "@deutsch-mate/domain";

export interface PublishResult {
  readonly transportMessageId: string;
}

export interface EventPublisher {
  publish(envelope: DomainEventEnvelope): Promise<PublishResult>;
}

/**
 * In-process recorder used by local runs and unit tests.
 * Production swaps this for an EventBridge adapter (DM-007).
 */
export class LocalRecordingPublisher implements EventPublisher {
  readonly published: DomainEventEnvelope[] = [];

  async publish(envelope: DomainEventEnvelope): Promise<PublishResult> {
    this.published.push(envelope);
    return { transportMessageId: envelope.eventId };
  }
}

/**
 * Documents the production interface without pulling AWS SDK here (DM-007).
 */
export class UnconfiguredEventBridgePublisher implements EventPublisher {
  async publish(envelope: DomainEventEnvelope): Promise<PublishResult> {
    void envelope;
    throw new Error(
      "EventBridge publisher is not configured in this environment. " +
        "Local/dev uses LocalRecordingPublisher; production wiring is owned by DM-007.",
    );
  }
}
