-- DM-021: required secondary indexes (docs/Database.md §5).
-- PK/UQ/EXCLUDE/FK-target indexes are implied by earlier migrations.

CREATE INDEX consent_events_user_purpose_occurred_idx
  ON iam.consent_events (user_id, purpose_code, occurred_at DESC, id DESC);

CREATE INDEX profile_versions_user_version_desc_idx
  ON learner.profile_versions (user_id, version DESC);

CREATE INDEX curriculum_releases_status_published_at_idx
  ON content.curriculum_releases (status, published_at DESC);

CREATE INDEX unit_versions_level_module_ordinal_idx
  ON content.unit_versions (level, module_key, ordinal);

CREATE INDEX activity_objectives_objective_activity_idx
  ON content.activity_objectives (objective_version_id, activity_version_id);

CREATE INDEX sessions_user_last_activity_idx
  ON learning.sessions (user_id, last_activity_at DESC);

CREATE INDEX activity_attempts_user_submitted_idx
  ON learning.activity_attempts (user_id, submitted_at DESC);

CREATE INDEX activity_attempts_session_submitted_idx
  ON learning.activity_attempts (session_id, submitted_at);

CREATE INDEX evidence_user_objective_observed_idx
  ON learning.evidence (user_id, objective_version_id, observed_at DESC);

CREATE INDEX review_items_user_due_active_idx
  ON learning.review_items (user_id, due_at)
  WHERE state IN ('due', 'scheduled');

CREATE INDEX recommendation_runs_user_created_idx
  ON learning.recommendation_runs (user_id, created_at DESC);

CREATE INDEX runs_user_created_idx
  ON ai.runs (user_id, created_at DESC);

CREATE INDEX runs_active_status_started_idx
  ON ai.runs (status, started_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX trace_events_run_sequence_idx
  ON ai.trace_events (run_id, sequence);

CREATE INDEX langgraph_checkpoints_thread_ns_created_idx
  ON ai.langgraph_checkpoints (thread_id, checkpoint_ns, created_at DESC);

CREATE UNIQUE INDEX ai_one_published_release_per_feature
  ON ai.releases (feature)
  WHERE status = 'published';

CREATE INDEX subscriptions_status_reconciled_idx
  ON billing.subscriptions (status, reconciled_at);

CREATE INDEX entitlements_user_feature_valid_active_idx
  ON billing.entitlements (user_id, feature_code, valid_until)
  WHERE status = 'active';

CREATE INDEX usage_events_entitlement_feature_period_idx
  ON billing.usage_events (entitlement_id, feature_code, period_start, period_end);

CREATE INDEX webhook_events_processing_next_attempt_idx
  ON billing.webhook_events (processing_status, next_attempt_at)
  WHERE processing_status IN ('received', 'failed');

CREATE INDEX reconciliation_runs_provider_started_idx
  ON billing.reconciliation_runs (provider, started_at DESC);

CREATE INDEX requests_status_due_open_idx
  ON privacy.requests (status, due_at)
  WHERE status NOT IN ('completed', 'partially_retained', 'rejected', 'cancelled');

CREATE INDEX outbox_events_available_pending_idx
  ON ops.outbox_events (available_at, occurred_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX inbox_events_consumer_status_received_idx
  ON ops.inbox_events (consumer_name, status, received_at);

CREATE INDEX audit_events_resource_occurred_idx
  ON ops.audit_events (resource_type, resource_id, occurred_at DESC);
