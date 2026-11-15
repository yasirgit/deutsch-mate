-- DM-021: ai schema (docs/Database.md §4.6).
-- Depends on learning.activity_attempts for ai.runs.attempt_id.

CREATE TABLE ai.prompt_versions (
  id uuid PRIMARY KEY,
  prompt_key varchar(100) NOT NULL,
  version integer NOT NULL,
  feature ai.feature_code NOT NULL,
  template text NOT NULL,
  input_schema jsonb NOT NULL,
  output_schema jsonb NOT NULL,
  safety_policy_version varchar(40) NOT NULL,
  sha256 char(64) NOT NULL,
  status content.release_status NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_versions_version_ck CHECK (version > 0),
  CONSTRAINT prompt_versions_sha256_hex_ck CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT prompt_versions_prompt_key_version_key UNIQUE (prompt_key, version)
);

CREATE INDEX prompt_versions_created_by_idx ON ai.prompt_versions (created_by);

CREATE TABLE ai.model_config_versions (
  id uuid PRIMARY KEY,
  config_key varchar(100) NOT NULL,
  version integer NOT NULL,
  provider varchar(40) NOT NULL,
  model_name varchar(100) NOT NULL,
  provider_model_version varchar(100) NULL,
  parameters jsonb NOT NULL,
  max_input_tokens integer NOT NULL,
  max_output_tokens integer NOT NULL,
  timeout_ms integer NOT NULL,
  data_policy_code varchar(40) NOT NULL,
  created_by uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_config_versions_version_ck CHECK (version > 0),
  CONSTRAINT model_config_versions_max_input_tokens_ck CHECK (max_input_tokens > 0),
  CONSTRAINT model_config_versions_max_output_tokens_ck CHECK (max_output_tokens > 0),
  CONSTRAINT model_config_versions_timeout_ms_ck CHECK (timeout_ms > 0),
  CONSTRAINT model_config_versions_config_key_version_key UNIQUE (config_key, version)
);

CREATE INDEX model_config_versions_created_by_idx ON ai.model_config_versions (created_by);

CREATE TABLE ai.releases (
  id uuid PRIMARY KEY,
  feature ai.feature_code NOT NULL,
  version integer NOT NULL,
  prompt_version_id uuid NOT NULL REFERENCES ai.prompt_versions (id) ON DELETE RESTRICT,
  model_config_version_id uuid NOT NULL REFERENCES ai.model_config_versions (id) ON DELETE RESTRICT,
  verifier_prompt_version_id uuid NULL REFERENCES ai.prompt_versions (id) ON DELETE RESTRICT,
  evaluation_result jsonb NOT NULL,
  status content.release_status NOT NULL,
  rollback_release_id uuid NULL REFERENCES ai.releases (id) ON DELETE RESTRICT,
  approved_by uuid NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  approved_at timestamptz NULL,
  published_by uuid NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  published_at timestamptz NULL,
  retired_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT releases_version_ck CHECK (version > 0),
  CONSTRAINT releases_approved_state_ck CHECK (
    status <> 'approved'
    OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)
  ),
  CONSTRAINT releases_published_state_ck CHECK (
    status <> 'published'
    OR (
      published_at IS NOT NULL
      AND published_by IS NOT NULL
      AND approved_at IS NOT NULL
      AND approved_by IS NOT NULL
    )
  ),
  CONSTRAINT releases_retired_state_ck CHECK (
    (status = 'retired' AND retired_at IS NOT NULL)
    OR (status <> 'retired' AND retired_at IS NULL)
  ),
  CONSTRAINT releases_feature_version_key UNIQUE (feature, version)
);

CREATE INDEX releases_prompt_version_id_idx ON ai.releases (prompt_version_id);
CREATE INDEX releases_model_config_version_id_idx ON ai.releases (model_config_version_id);
CREATE INDEX releases_verifier_prompt_version_id_idx ON ai.releases (verifier_prompt_version_id);
CREATE INDEX releases_rollback_release_id_idx ON ai.releases (rollback_release_id);
CREATE INDEX releases_created_by_idx ON ai.releases (created_by);

CREATE TABLE ai.threads (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  feature ai.feature_code NOT NULL,
  context_unit_version_id uuid NULL REFERENCES content.unit_versions (id) ON DELETE RESTRICT,
  retention_until timestamptz NOT NULL,
  closed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX threads_user_id_idx ON ai.threads (user_id);
CREATE INDEX threads_context_unit_version_id_idx ON ai.threads (context_unit_version_id);

CREATE TABLE ai.runs (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES ai.threads (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  release_id uuid NOT NULL REFERENCES ai.releases (id) ON DELETE RESTRICT,
  attempt_id uuid NULL REFERENCES learning.activity_attempts (id) ON DELETE RESTRICT,
  status ai.run_status NOT NULL,
  disposition ai.disposition NULL,
  trace_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  first_verified_delta_at timestamptz NULL,
  completed_at timestamptz NULL,
  latency_ms integer NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_micros bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'USD',
  error_code varchar(80) NULL,
  verifier_summary jsonb NULL,
  content_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runs_trace_id_key UNIQUE (trace_id),
  CONSTRAINT runs_input_tokens_ck CHECK (input_tokens >= 0),
  CONSTRAINT runs_output_tokens_ck CHECK (output_tokens >= 0),
  CONSTRAINT runs_estimated_cost_micros_ck CHECK (estimated_cost_micros >= 0),
  CONSTRAINT runs_latency_ms_ck CHECK (latency_ms IS NULL OR latency_ms >= 0)
);

CREATE INDEX runs_thread_id_idx ON ai.runs (thread_id);
CREATE INDEX runs_release_id_idx ON ai.runs (release_id);
CREATE INDEX runs_attempt_id_idx ON ai.runs (attempt_id);
CREATE INDEX runs_user_id_idx ON ai.runs (user_id);

CREATE TABLE ai.messages (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES ai.runs (id) ON DELETE RESTRICT,
  sequence integer NOT NULL,
  role ai.message_role NOT NULL,
  content text NULL,
  content_sha256 char(64) NOT NULL,
  redaction_summary jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_sequence_ck CHECK (sequence > 0),
  CONSTRAINT messages_content_sha256_hex_ck CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT messages_run_sequence_key UNIQUE (run_id, sequence)
);

CREATE TABLE ai.trace_events (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES ai.runs (id) ON DELETE RESTRICT,
  sequence integer NOT NULL,
  event_type varchar(40) NOT NULL,
  name text NOT NULL,
  metadata jsonb NOT NULL,
  sensitive_content_s3_id uuid NULL REFERENCES media.objects (id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trace_events_sequence_ck CHECK (sequence > 0),
  CONSTRAINT trace_events_event_type_ck CHECK (
    event_type IN (
      'retrieval',
      'tool_call',
      'tool_result',
      'model_call',
      'model_result',
      'verifier',
      'stream',
      'disposition',
      'error'
    )
  ),
  CONSTRAINT trace_events_run_sequence_key UNIQUE (run_id, sequence)
);

CREATE INDEX trace_events_sensitive_content_s3_id_idx
  ON ai.trace_events (sensitive_content_s3_id);

CREATE TABLE ai.langgraph_checkpoints (
  thread_id uuid NOT NULL REFERENCES ai.threads (id) ON DELETE RESTRICT,
  checkpoint_ns text NOT NULL DEFAULT '',
  checkpoint_id text NOT NULL,
  parent_checkpoint_id text NULL,
  checkpoint jsonb NOT NULL,
  metadata jsonb NOT NULL,
  channel_versions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE ai.langgraph_writes (
  thread_id uuid NOT NULL,
  checkpoint_ns text NOT NULL,
  checkpoint_id text NOT NULL,
  task_id text NOT NULL,
  idx integer NOT NULL,
  channel text NOT NULL,
  value jsonb NOT NULL,
  task_path text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx),
  CONSTRAINT langgraph_writes_checkpoint_fk FOREIGN KEY (thread_id, checkpoint_ns, checkpoint_id)
    REFERENCES ai.langgraph_checkpoints (thread_id, checkpoint_ns, checkpoint_id)
    ON DELETE RESTRICT
);
