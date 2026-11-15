-- DM-021: ops primitives (docs/Database.md §4.8).
-- idempotency_keys must exist before billing.checkout_sessions.

CREATE TABLE ops.idempotency_keys (
  id uuid PRIMARY KEY,
  scope varchar(60) NOT NULL,
  actor_user_id uuid NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  state varchar(20) NOT NULL,
  response_status smallint NULL,
  response_body jsonb NULL,
  resource_type varchar(50) NULL,
  resource_id uuid NULL,
  locked_until timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_keys_state_ck CHECK (state IN ('processing', 'completed', 'failed')),
  CONSTRAINT idempotency_keys_request_hash_ck CHECK (request_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX idempotency_keys_scope_actor_key_uidx
  ON ops.idempotency_keys (scope, actor_user_id, key)
  NULLS NOT DISTINCT;

CREATE INDEX idempotency_keys_actor_user_id_idx ON ops.idempotency_keys (actor_user_id);

CREATE TABLE ops.outbox_events (
  id uuid PRIMARY KEY,
  aggregate_type varchar(50) NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type varchar(100) NOT NULL,
  event_version smallint NOT NULL,
  payload jsonb NOT NULL,
  headers jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid NULL,
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  status ops.delivery_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz NULL,
  published_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_events_event_version_ck CHECK (event_version > 0),
  CONSTRAINT outbox_events_attempt_count_ck CHECK (attempt_count >= 0)
);

CREATE TABLE ops.inbox_events (
  id uuid PRIMARY KEY,
  consumer_name varchar(100) NOT NULL,
  message_id uuid NOT NULL,
  event_type varchar(100) NOT NULL,
  payload_sha256 char(64) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL,
  status varchar(20) NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text NULL,
  result jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_events_status_ck CHECK (
    status IN ('processing', 'processed', 'failed', 'dead_letter')
  ),
  CONSTRAINT inbox_events_payload_sha256_ck CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT inbox_events_attempt_count_ck CHECK (attempt_count >= 0),
  CONSTRAINT inbox_events_consumer_message_key UNIQUE (consumer_name, message_id)
);

CREATE TABLE ops.audit_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  actor_type varchar(20) NOT NULL,
  action varchar(100) NOT NULL,
  resource_type varchar(60) NOT NULL,
  resource_id uuid NULL,
  outcome varchar(20) NOT NULL,
  reason_code varchar(60) NULL,
  correlation_id uuid NOT NULL,
  ip_hash bytea NULL,
  metadata jsonb NOT NULL,
  previous_hash char(64) NULL,
  event_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_actor_type_ck CHECK (
    actor_type IN ('user', 'staff', 'service', 'provider')
  ),
  CONSTRAINT audit_events_outcome_ck CHECK (outcome IN ('success', 'denied', 'failed')),
  CONSTRAINT audit_events_previous_hash_ck CHECK (
    previous_hash IS NULL OR previous_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT audit_events_event_hash_ck CHECK (event_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX audit_events_actor_user_id_idx ON ops.audit_events (actor_user_id);
