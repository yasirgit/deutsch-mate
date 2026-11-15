-- DM-021: privacy and support schemas (docs/Database.md §4.8).

CREATE TABLE privacy.requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  type privacy.request_type NOT NULL,
  status privacy.request_status NOT NULL DEFAULT 'requested',
  requested_at timestamptz NOT NULL DEFAULT now(),
  identity_verified_at timestamptz NULL,
  due_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  export_object_id uuid NULL REFERENCES media.objects (id) ON DELETE RESTRICT,
  retention_exceptions jsonb NOT NULL,
  failure_code varchar(80) NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT requests_lock_version_ck CHECK (lock_version > 0)
);

CREATE INDEX requests_user_id_idx ON privacy.requests (user_id);
CREATE INDEX requests_export_object_id_idx ON privacy.requests (export_object_id);

CREATE TABLE privacy.request_events (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES privacy.requests (id) ON DELETE RESTRICT,
  from_status privacy.request_status NULL,
  to_status privacy.request_status NOT NULL,
  actor_user_id uuid NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  details jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX request_events_request_id_idx ON privacy.request_events (request_id);
CREATE INDEX request_events_actor_user_id_idx ON privacy.request_events (actor_user_id);

CREATE TABLE privacy.erasure_tasks (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES privacy.requests (id) ON DELETE RESTRICT,
  system_code varchar(40) NOT NULL,
  status varchar(20) NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  retention_until timestamptz NULL,
  evidence jsonb NOT NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT erasure_tasks_system_code_ck CHECK (
    system_code IN (
      'postgres',
      'cognito',
      's3',
      'redis',
      'stripe_metadata',
      'analytics',
      'backups'
    )
  ),
  CONSTRAINT erasure_tasks_status_ck CHECK (
    status IN ('pending', 'running', 'completed', 'retained', 'failed')
  ),
  CONSTRAINT erasure_tasks_attempt_count_ck CHECK (attempt_count >= 0),
  CONSTRAINT erasure_tasks_lock_version_ck CHECK (lock_version > 0),
  CONSTRAINT erasure_tasks_request_system_key UNIQUE (request_id, system_code)
);

CREATE TABLE support.cases (
  id uuid PRIMARY KEY,
  user_id uuid NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  category support.case_category NOT NULL,
  status support.case_status NOT NULL DEFAULT 'open',
  subject text NOT NULL,
  description text NOT NULL,
  contact_email citext NULL,
  ai_run_id uuid NULL REFERENCES ai.runs (id) ON DELETE RESTRICT,
  assigned_to uuid NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT cases_lock_version_ck CHECK (lock_version > 0)
);

CREATE INDEX cases_user_id_idx ON support.cases (user_id);
CREATE INDEX cases_ai_run_id_idx ON support.cases (ai_run_id);
CREATE INDEX cases_assigned_to_idx ON support.cases (assigned_to);

CREATE TABLE support.case_events (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES support.cases (id) ON DELETE RESTRICT,
  actor_user_id uuid NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  event_type varchar(20) NOT NULL,
  body text NULL,
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_events_event_type_ck CHECK (
    event_type IN ('created', 'status_changed', 'note', 'assigned', 'resolved')
  )
);

CREATE INDEX case_events_case_id_idx ON support.case_events (case_id);
CREATE INDEX case_events_actor_user_id_idx ON support.case_events (actor_user_id);
