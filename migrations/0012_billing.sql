-- DM-021: billing schema (docs/Database.md §4.7).
-- Depends on ops.idempotency_keys; entitlement_events FK webhook_events is DEFERRABLE.

CREATE TABLE billing.plans (
  id uuid PRIMARY KEY,
  plan_code varchar(40) NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT plans_plan_code_key UNIQUE (plan_code),
  CONSTRAINT plans_lock_version_ck CHECK (lock_version > 0)
);

CREATE TABLE billing.plan_prices (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES billing.plans (id) ON DELETE RESTRICT,
  provider billing.provider_code NOT NULL,
  provider_price_id text NULL,
  currency char(3) NOT NULL,
  amount_minor bigint NOT NULL,
  billing_interval varchar(10) NOT NULL,
  tax_behavior varchar(20) NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_prices_amount_minor_ck CHECK (amount_minor >= 0),
  CONSTRAINT plan_prices_billing_interval_ck CHECK (
    billing_interval IN ('none', 'month', 'year')
  ),
  CONSTRAINT plan_prices_tax_behavior_ck CHECK (
    tax_behavior IN ('inclusive', 'exclusive', 'unspecified')
  ),
  CONSTRAINT plan_prices_effective_range_ck CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT plan_prices_no_overlap EXCLUDE USING gist (
    plan_id WITH =,
    provider WITH =,
    currency WITH =,
    billing_interval WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  )
);

CREATE UNIQUE INDEX plan_prices_provider_price_id_uidx
  ON billing.plan_prices (provider, provider_price_id)
  WHERE provider_price_id IS NOT NULL;

CREATE INDEX plan_prices_plan_id_idx ON billing.plan_prices (plan_id);

CREATE TABLE billing.plan_features (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES billing.plans (id) ON DELETE RESTRICT,
  feature_code varchar(60) NOT NULL,
  config_version integer NOT NULL,
  limit_value bigint NULL,
  limit_period varchar(20) NULL,
  enabled boolean NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_features_config_version_ck CHECK (config_version > 0),
  CONSTRAINT plan_features_limit_period_ck CHECK (
    limit_period IS NULL OR limit_period IN ('day', 'month', 'billing_period')
  ),
  CONSTRAINT plan_features_effective_range_ck CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT plan_features_no_overlap EXCLUDE USING gist (
    plan_id WITH =,
    feature_code WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  )
);

CREATE INDEX plan_features_plan_id_idx ON billing.plan_features (plan_id);

CREATE TABLE billing.customers (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  provider billing.provider_code NOT NULL,
  provider_customer_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT customers_lock_version_ck CHECK (lock_version > 0),
  CONSTRAINT customers_user_provider_key UNIQUE (user_id, provider),
  CONSTRAINT customers_provider_customer_key UNIQUE (provider, provider_customer_id)
);

CREATE TABLE billing.checkout_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  provider billing.provider_code NOT NULL DEFAULT 'stripe',
  plan_price_id uuid NOT NULL REFERENCES billing.plan_prices (id) ON DELETE RESTRICT,
  provider_checkout_id text NULL,
  status varchar(20) NOT NULL DEFAULT 'creating',
  success_url_hash char(64) NOT NULL,
  cancel_url_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  idempotency_key_id uuid NOT NULL REFERENCES ops.idempotency_keys (id) ON DELETE RESTRICT,
  last_error_code varchar(80) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT checkout_sessions_status_ck CHECK (
    status IN ('creating', 'open', 'completed', 'expired', 'failed')
  ),
  CONSTRAINT checkout_sessions_success_url_hash_ck CHECK (success_url_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkout_sessions_cancel_url_hash_ck CHECK (cancel_url_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkout_sessions_lock_version_ck CHECK (lock_version > 0),
  CONSTRAINT checkout_sessions_idempotency_key_id_key UNIQUE (idempotency_key_id)
);

CREATE UNIQUE INDEX checkout_sessions_provider_checkout_id_uidx
  ON billing.checkout_sessions (provider, provider_checkout_id)
  WHERE provider_checkout_id IS NOT NULL;

CREATE INDEX checkout_sessions_user_id_idx ON billing.checkout_sessions (user_id);
CREATE INDEX checkout_sessions_plan_price_id_idx ON billing.checkout_sessions (plan_price_id);

CREATE TABLE billing.subscriptions (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES billing.customers (id) ON DELETE RESTRICT,
  provider_subscription_id text NOT NULL,
  plan_price_id uuid NOT NULL REFERENCES billing.plan_prices (id) ON DELETE RESTRICT,
  status billing.subscription_status NOT NULL,
  provider_event_created_at timestamptz NOT NULL,
  current_period_start timestamptz NULL,
  current_period_end timestamptz NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz NULL,
  ended_at timestamptz NULL,
  reconciled_at timestamptz NULL,
  provider_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT subscriptions_lock_version_ck CHECK (lock_version > 0),
  CONSTRAINT subscriptions_customer_provider_subscription_key UNIQUE (
    customer_id,
    provider_subscription_id
  )
);

CREATE INDEX subscriptions_plan_price_id_idx ON billing.subscriptions (plan_price_id);

CREATE TABLE billing.webhook_events (
  id uuid PRIMARY KEY,
  provider billing.provider_code NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  provider_created_at timestamptz NOT NULL,
  signature_verified_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  payload_sha256 char(64) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processing_status varchar(20) NOT NULL DEFAULT 'received',
  attempt_count integer NOT NULL DEFAULT 0,
  processed_at timestamptz NULL,
  next_attempt_at timestamptz NULL,
  last_error_code varchar(80) NULL,
  last_error_detail text NULL,
  correlation_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT webhook_events_processing_status_ck CHECK (
    processing_status IN (
      'received',
      'processing',
      'processed',
      'ignored',
      'failed',
      'dead_letter'
    )
  ),
  CONSTRAINT webhook_events_payload_sha256_ck CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT webhook_events_attempt_count_ck CHECK (attempt_count >= 0),
  CONSTRAINT webhook_events_lock_version_ck CHECK (lock_version > 0),
  CONSTRAINT webhook_events_provider_event_key UNIQUE (provider, provider_event_id)
);

CREATE TABLE billing.entitlements (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  feature_code varchar(60) NOT NULL,
  source_provider billing.provider_code NOT NULL,
  source_subscription_id uuid NULL REFERENCES billing.subscriptions (id) ON DELETE RESTRICT,
  status billing.entitlement_status NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NULL,
  allowance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT entitlements_valid_range_ck CHECK (
    valid_until IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT entitlements_lock_version_ck CHECK (lock_version > 0),
  CONSTRAINT entitlements_active_no_overlap EXCLUDE USING gist (
    user_id WITH =,
    feature_code WITH =,
    source_provider WITH =,
    tstzrange(valid_from, valid_until, '[)') WITH &&
  )
  WHERE (status = 'active')
);

CREATE INDEX entitlements_source_subscription_id_idx
  ON billing.entitlements (source_subscription_id);

CREATE TABLE billing.entitlement_events (
  id uuid PRIMARY KEY,
  entitlement_id uuid NOT NULL REFERENCES billing.entitlements (id) ON DELETE RESTRICT,
  webhook_event_id uuid NULL,
  action varchar(20) NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  reason_code varchar(40) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entitlement_events_action_ck CHECK (
    action IN ('grant', 'change', 'expire', 'revoke', 'reconcile')
  ),
  CONSTRAINT entitlement_events_webhook_event_id_fk FOREIGN KEY (webhook_event_id)
    REFERENCES billing.webhook_events (id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX entitlement_events_entitlement_id_idx
  ON billing.entitlement_events (entitlement_id);
CREATE INDEX entitlement_events_webhook_event_id_idx
  ON billing.entitlement_events (webhook_event_id);

CREATE TABLE billing.usage_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  entitlement_id uuid NOT NULL REFERENCES billing.entitlements (id) ON DELETE RESTRICT,
  feature_code varchar(60) NOT NULL,
  quantity bigint NOT NULL,
  unit varchar(20) NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  source_type varchar(30) NOT NULL,
  source_id uuid NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_events_quantity_ck CHECK (quantity <> 0),
  CONSTRAINT usage_events_unit_ck CHECK (unit IN ('request', 'token', 'item')),
  CONSTRAINT usage_events_period_ck CHECK (period_end > period_start),
  CONSTRAINT usage_events_entitlement_feature_idempotency_key UNIQUE (
    entitlement_id,
    feature_code,
    idempotency_key
  )
);

CREATE INDEX usage_events_user_id_idx ON billing.usage_events (user_id);

CREATE TABLE billing.reconciliation_runs (
  id uuid PRIMARY KEY,
  provider billing.provider_code NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  status varchar(20) NOT NULL DEFAULT 'running',
  cursor text NULL,
  checked_count integer NOT NULL DEFAULT 0,
  mismatch_count integer NOT NULL DEFAULT 0,
  repaired_count integer NOT NULL DEFAULT 0,
  alerted_count integer NOT NULL DEFAULT 0,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_runs_status_ck CHECK (
    status IN ('running', 'completed', 'failed')
  ),
  CONSTRAINT reconciliation_runs_counts_ck CHECK (
    checked_count >= 0
    AND mismatch_count >= 0
    AND repaired_count >= 0
    AND alerted_count >= 0
  )
);

CREATE TABLE billing.reconciliation_items (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES billing.reconciliation_runs (id) ON DELETE RESTRICT,
  subscription_id uuid NULL REFERENCES billing.subscriptions (id) ON DELETE RESTRICT,
  provider_object_id text NOT NULL,
  mismatch_code varchar(60) NOT NULL,
  internal_snapshot jsonb NOT NULL,
  provider_snapshot jsonb NOT NULL,
  resolution varchar(20) NOT NULL,
  entitlement_event_id uuid NULL REFERENCES billing.entitlement_events (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_items_resolution_ck CHECK (
    resolution IN ('repaired', 'alerted', 'no_change')
  ),
  CONSTRAINT reconciliation_items_run_object_mismatch_key UNIQUE (
    run_id,
    provider_object_id,
    mismatch_code
  )
);

CREATE INDEX reconciliation_items_subscription_id_idx
  ON billing.reconciliation_items (subscription_id);
CREATE INDEX reconciliation_items_entitlement_event_id_idx
  ON billing.reconciliation_items (entitlement_event_id);
