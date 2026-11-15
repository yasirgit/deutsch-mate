-- DM-021: learner profiles, onboarding, proficiency (docs/Database.md §4.2).

CREATE TABLE learner.profile_versions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  version integer NOT NULL,
  goal learner.goal_code NOT NULL,
  selected_level learner.cefr_level NOT NULL,
  target_level learner.cefr_level NULL,
  study_minutes_per_day smallint NULL,
  study_days_per_week smallint NULL,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_at timestamptz NOT NULL DEFAULT now(),
  supersedes_id uuid NULL REFERENCES learner.profile_versions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_versions_version_ck CHECK (version > 0),
  CONSTRAINT profile_versions_study_minutes_ck CHECK (
    study_minutes_per_day IS NULL OR study_minutes_per_day BETWEEN 5 AND 180
  ),
  CONSTRAINT profile_versions_study_days_ck CHECK (
    study_days_per_week IS NULL OR study_days_per_week BETWEEN 1 AND 7
  ),
  CONSTRAINT profile_versions_preferences_object_ck CHECK (jsonb_typeof(preferences) = 'object'),
  CONSTRAINT profile_versions_user_version_key UNIQUE (user_id, version),
  CONSTRAINT profile_versions_supersedes_id_key UNIQUE (supersedes_id)
);

CREATE TABLE learner.onboarding_states (
  user_id uuid PRIMARY KEY REFERENCES iam.users (id) ON DELETE RESTRICT,
  step_code varchar(40) NOT NULL DEFAULT 'legal',
  completed_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_at timestamptz NULL,
  recommended_unit_version_id uuid NULL REFERENCES content.unit_versions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT onboarding_states_completed_steps_array_ck CHECK (
    jsonb_typeof(completed_steps) = 'array'
  ),
  CONSTRAINT onboarding_states_lock_version_ck CHECK (lock_version > 0)
);

CREATE INDEX onboarding_states_recommended_unit_version_id_idx
  ON learner.onboarding_states (recommended_unit_version_id);

CREATE TABLE learner.proficiency_snapshots (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  sequence integer NOT NULL,
  algorithm_version varchar(40) NOT NULL,
  evidence_cutoff_at timestamptz NOT NULL,
  skill_vector jsonb NOT NULL,
  overall_estimate learner.cefr_level NULL,
  disclaimer_code varchar(40) NOT NULL DEFAULT 'cefr_estimate_not_certificate',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proficiency_snapshots_sequence_ck CHECK (sequence > 0),
  CONSTRAINT proficiency_snapshots_skill_vector_object_ck CHECK (
    jsonb_typeof(skill_vector) = 'object'
  ),
  CONSTRAINT proficiency_snapshots_user_sequence_key UNIQUE (user_id, sequence)
);

CREATE INDEX proficiency_snapshots_user_id_idx ON learner.proficiency_snapshots (user_id);
