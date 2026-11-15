-- DM-021: learning core tables without ai.runs FK (docs/Database.md §4.5).
-- feedback_records arrive after ai.runs in 0011.

CREATE TABLE learning.sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  curriculum_release_id uuid NOT NULL REFERENCES content.curriculum_releases (id) ON DELETE RESTRICT,
  unit_version_id uuid NOT NULL REFERENCES content.unit_versions (id) ON DELETE RESTRICT,
  lesson_version_id uuid NULL REFERENCES content.lesson_versions (id) ON DELETE RESTRICT,
  client_platform varchar(20) NOT NULL,
  status learning.session_status NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT sessions_completed_order_ck CHECK (
    completed_at IS NULL OR completed_at >= started_at
  ),
  CONSTRAINT sessions_lock_version_ck CHECK (lock_version > 0)
);

CREATE INDEX sessions_curriculum_release_id_idx ON learning.sessions (curriculum_release_id);
CREATE INDEX sessions_unit_version_id_idx ON learning.sessions (unit_version_id);
CREATE INDEX sessions_lesson_version_id_idx ON learning.sessions (lesson_version_id);
CREATE INDEX sessions_user_id_idx ON learning.sessions (user_id);

CREATE TABLE learning.activity_attempts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES learning.sessions (id) ON DELETE RESTRICT,
  activity_version_id uuid NOT NULL REFERENCES content.activity_versions (id) ON DELETE RESTRICT,
  answer_key_version_id uuid NULL REFERENCES content.answer_key_versions (id) ON DELETE RESTRICT,
  rubric_version_id uuid NULL REFERENCES content.rubric_versions (id) ON DELETE RESTRICT,
  attempt_number smallint NOT NULL,
  client_attempt_id uuid NOT NULL,
  status learning.attempt_status NOT NULL,
  submitted_at timestamptz NOT NULL,
  duration_ms integer NULL,
  algorithm_version varchar(40) NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_attempts_attempt_number_ck CHECK (attempt_number > 0),
  CONSTRAINT activity_attempts_duration_ms_ck CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT activity_attempts_user_client_attempt_key UNIQUE (user_id, client_attempt_id),
  CONSTRAINT activity_attempts_user_activity_number_key UNIQUE (
    user_id,
    activity_version_id,
    attempt_number
  )
);

CREATE INDEX activity_attempts_session_id_idx ON learning.activity_attempts (session_id);
CREATE INDEX activity_attempts_activity_version_id_idx
  ON learning.activity_attempts (activity_version_id);
CREATE INDEX activity_attempts_answer_key_version_id_idx
  ON learning.activity_attempts (answer_key_version_id);
CREATE INDEX activity_attempts_rubric_version_id_idx
  ON learning.activity_attempts (rubric_version_id);

CREATE TABLE learning.attempt_responses (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES learning.activity_attempts (id) ON DELETE RESTRICT,
  response_kind varchar(20) NOT NULL,
  response jsonb NULL,
  text_content text NULL,
  content_expires_at timestamptz NULL,
  sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attempt_responses_kind_ck CHECK (
    response_kind IN ('structured', 'text', 'choice')
  ),
  CONSTRAINT attempt_responses_exactly_one_body_ck CHECK (
    (response IS NOT NULL AND text_content IS NULL)
    OR (response IS NULL AND text_content IS NOT NULL)
  ),
  CONSTRAINT attempt_responses_sha256_hex_ck CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT attempt_responses_attempt_id_key UNIQUE (attempt_id)
);

CREATE TABLE learning.attempt_scores (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES learning.activity_attempts (id) ON DELETE RESTRICT,
  score numeric(8, 3) NOT NULL,
  max_score numeric(8, 3) NOT NULL,
  passed boolean NOT NULL,
  scoring_method varchar(20) NOT NULL,
  algorithm_version varchar(40) NOT NULL,
  details jsonb NOT NULL,
  supersedes_score_id uuid NULL REFERENCES learning.attempt_scores (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attempt_scores_max_score_ck CHECK (max_score >= 0),
  CONSTRAINT attempt_scores_method_ck CHECK (
    scoring_method IN ('deterministic', 'verified_ai')
  ),
  CONSTRAINT attempt_scores_supersedes_score_id_key UNIQUE (supersedes_score_id)
);

CREATE INDEX attempt_scores_attempt_id_idx ON learning.attempt_scores (attempt_id);

CREATE TABLE learning.evidence (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL REFERENCES learning.activity_attempts (id) ON DELETE RESTRICT,
  objective_version_id uuid NOT NULL REFERENCES content.objective_versions (id) ON DELETE RESTRICT,
  score_ratio numeric(6, 5) NULL,
  validity learning.evidence_validity NOT NULL,
  reason_code varchar(40) NOT NULL,
  observed_at timestamptz NOT NULL,
  algorithm_version varchar(40) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_score_ratio_ck CHECK (
    score_ratio IS NULL OR (score_ratio >= 0 AND score_ratio <= 1)
  ),
  CONSTRAINT evidence_attempt_objective_algorithm_key UNIQUE (
    attempt_id,
    objective_version_id,
    algorithm_version
  )
);

CREATE INDEX evidence_user_id_idx ON learning.evidence (user_id);
CREATE INDEX evidence_objective_version_id_idx ON learning.evidence (objective_version_id);

CREATE TABLE learning.review_items (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  objective_version_id uuid NOT NULL REFERENCES content.objective_versions (id) ON DELETE RESTRICT,
  source_attempt_id uuid NOT NULL REFERENCES learning.activity_attempts (id) ON DELETE RESTRICT,
  algorithm_version varchar(40) NOT NULL,
  due_at timestamptz NOT NULL,
  interval_days numeric(8, 2) NOT NULL,
  ease numeric(6, 3) NOT NULL,
  state varchar(20) NOT NULL,
  last_evidence_id uuid NOT NULL REFERENCES learning.evidence (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT review_items_state_ck CHECK (
    state IN ('due', 'scheduled', 'completed', 'suspended')
  ),
  CONSTRAINT review_items_lock_version_ck CHECK (lock_version > 0),
  CONSTRAINT review_items_user_objective_attempt_key UNIQUE (
    user_id,
    objective_version_id,
    source_attempt_id
  )
);

CREATE INDEX review_items_objective_version_id_idx ON learning.review_items (objective_version_id);
CREATE INDEX review_items_source_attempt_id_idx ON learning.review_items (source_attempt_id);
CREATE INDEX review_items_last_evidence_id_idx ON learning.review_items (last_evidence_id);

CREATE TABLE learning.recommendation_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  algorithm_version varchar(40) NOT NULL,
  profile_version_id uuid NOT NULL REFERENCES learner.profile_versions (id) ON DELETE RESTRICT,
  proficiency_snapshot_id uuid NULL REFERENCES learner.proficiency_snapshots (id) ON DELETE RESTRICT,
  entitlement_snapshot jsonb NOT NULL,
  candidate_snapshot jsonb NOT NULL,
  kind learning.recommendation_kind NOT NULL,
  recommended_unit_version_id uuid NULL REFERENCES content.unit_versions (id) ON DELETE RESTRICT,
  recommended_review_item_id uuid NULL REFERENCES learning.review_items (id) ON DELETE RESTRICT,
  reason_codes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_runs_target_ck CHECK (
    (
      kind = 'lesson'
      AND recommended_unit_version_id IS NOT NULL
      AND recommended_review_item_id IS NULL
    )
    OR (
      kind = 'review'
      AND recommended_review_item_id IS NOT NULL
      AND recommended_unit_version_id IS NULL
    )
    OR (
      kind = 'upgrade'
      AND recommended_unit_version_id IS NOT NULL
      AND recommended_review_item_id IS NULL
    )
  )
);

CREATE INDEX recommendation_runs_profile_version_id_idx
  ON learning.recommendation_runs (profile_version_id);
CREATE INDEX recommendation_runs_proficiency_snapshot_id_idx
  ON learning.recommendation_runs (proficiency_snapshot_id);
CREATE INDEX recommendation_runs_recommended_unit_version_id_idx
  ON learning.recommendation_runs (recommended_unit_version_id);
CREATE INDEX recommendation_runs_recommended_review_item_id_idx
  ON learning.recommendation_runs (recommended_review_item_id);

CREATE TABLE learning.unit_progress (
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  unit_version_id uuid NOT NULL REFERENCES content.unit_versions (id) ON DELETE RESTRICT,
  completed_required integer NOT NULL DEFAULT 0,
  required_total integer NOT NULL,
  completion_ratio numeric(6, 5) NOT NULL,
  completed_at timestamptz NULL,
  last_attempt_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, unit_version_id),
  CONSTRAINT unit_progress_completed_required_ck CHECK (completed_required >= 0),
  CONSTRAINT unit_progress_required_total_ck CHECK (required_total >= 0),
  CONSTRAINT unit_progress_completion_ratio_ck CHECK (
    completion_ratio >= 0 AND completion_ratio <= 1
  ),
  CONSTRAINT unit_progress_lock_version_ck CHECK (lock_version > 0)
);

CREATE INDEX unit_progress_unit_version_id_idx ON learning.unit_progress (unit_version_id);
