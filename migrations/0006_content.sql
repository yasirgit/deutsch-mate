-- DM-021: content schema — immutable curriculum graph (docs/Database.md §4.4).

CREATE TABLE content.curriculum_releases (
  id uuid PRIMARY KEY,
  release_key varchar(80) NOT NULL,
  version integer NOT NULL,
  status content.release_status NOT NULL DEFAULT 'draft',
  title text NOT NULL,
  description text NOT NULL,
  manifest_sha256 char(64) NOT NULL,
  approved_by uuid NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  approved_at timestamptz NULL,
  published_by uuid NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  published_at timestamptz NULL,
  retired_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_releases_version_ck CHECK (version > 0),
  CONSTRAINT curriculum_releases_manifest_sha256_ck CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT curriculum_releases_approved_state_ck CHECK (
    status <> 'approved'
    OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)
  ),
  CONSTRAINT curriculum_releases_published_state_ck CHECK (
    status <> 'published'
    OR (
      published_at IS NOT NULL
      AND published_by IS NOT NULL
      AND approved_at IS NOT NULL
      AND approved_by IS NOT NULL
    )
  ),
  CONSTRAINT curriculum_releases_retired_state_ck CHECK (
    (status = 'retired' AND retired_at IS NOT NULL)
    OR (status <> 'retired' AND retired_at IS NULL)
  ),
  CONSTRAINT curriculum_releases_release_key_version_key UNIQUE (release_key, version)
);

CREATE INDEX curriculum_releases_created_by_idx ON content.curriculum_releases (created_by);
CREATE INDEX curriculum_releases_approved_by_idx ON content.curriculum_releases (approved_by);
CREATE INDEX curriculum_releases_published_by_idx ON content.curriculum_releases (published_by);

CREATE TABLE content.module_versions (
  id uuid PRIMARY KEY,
  module_key varchar(80) NOT NULL,
  version integer NOT NULL,
  level learner.cefr_level NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  ordinal smallint NOT NULL,
  created_by uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_versions_version_ck CHECK (version > 0),
  CONSTRAINT module_versions_ordinal_ck CHECK (ordinal > 0),
  CONSTRAINT module_versions_module_key_version_key UNIQUE (module_key, version)
);

CREATE INDEX module_versions_created_by_idx ON content.module_versions (created_by);

CREATE TABLE content.release_modules (
  release_id uuid NOT NULL REFERENCES content.curriculum_releases (id) ON DELETE RESTRICT,
  module_version_id uuid NOT NULL REFERENCES content.module_versions (id) ON DELETE RESTRICT,
  ordinal smallint NOT NULL,
  PRIMARY KEY (release_id, module_version_id),
  CONSTRAINT release_modules_ordinal_ck CHECK (ordinal > 0),
  CONSTRAINT release_modules_release_ordinal_key UNIQUE (release_id, ordinal)
);

CREATE INDEX release_modules_module_version_id_idx
  ON content.release_modules (module_version_id);

CREATE TABLE content.unit_versions (
  id uuid PRIMARY KEY,
  unit_key varchar(80) NOT NULL,
  version integer NOT NULL,
  module_key varchar(80) NOT NULL,
  level learner.cefr_level NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  ordinal smallint NOT NULL,
  estimated_minutes smallint NOT NULL,
  access_tier varchar(20) NOT NULL,
  created_by uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_versions_version_ck CHECK (version > 0),
  CONSTRAINT unit_versions_ordinal_ck CHECK (ordinal > 0),
  CONSTRAINT unit_versions_estimated_minutes_ck CHECK (estimated_minutes BETWEEN 1 AND 180),
  CONSTRAINT unit_versions_access_tier_ck CHECK (access_tier IN ('free', 'premium')),
  CONSTRAINT unit_versions_unit_key_version_key UNIQUE (unit_key, version)
);

CREATE INDEX unit_versions_created_by_idx ON content.unit_versions (created_by);

CREATE TABLE content.module_units (
  module_version_id uuid NOT NULL REFERENCES content.module_versions (id) ON DELETE RESTRICT,
  unit_version_id uuid NOT NULL REFERENCES content.unit_versions (id) ON DELETE RESTRICT,
  ordinal smallint NOT NULL,
  PRIMARY KEY (module_version_id, unit_version_id),
  CONSTRAINT module_units_ordinal_ck CHECK (ordinal > 0),
  CONSTRAINT module_units_module_ordinal_key UNIQUE (module_version_id, ordinal)
);

CREATE INDEX module_units_unit_version_id_idx ON content.module_units (unit_version_id);

CREATE TABLE content.objective_versions (
  id uuid PRIMARY KEY,
  objective_key varchar(100) NOT NULL,
  version integer NOT NULL,
  level learner.cefr_level NOT NULL,
  skill content.skill_code NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  created_by uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT objective_versions_version_ck CHECK (version > 0),
  CONSTRAINT objective_versions_objective_key_version_key UNIQUE (objective_key, version)
);

CREATE INDEX objective_versions_created_by_idx ON content.objective_versions (created_by);

CREATE TABLE content.cefr_descriptor_versions (
  id uuid PRIMARY KEY,
  descriptor_key varchar(100) NOT NULL,
  version integer NOT NULL,
  level learner.cefr_level NOT NULL,
  skill content.skill_code NOT NULL,
  source_name text NOT NULL,
  source_edition text NOT NULL,
  descriptor_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cefr_descriptor_versions_version_ck CHECK (version > 0),
  CONSTRAINT cefr_descriptor_versions_descriptor_key_version_key UNIQUE (descriptor_key, version)
);

CREATE TABLE content.unit_objectives (
  unit_version_id uuid NOT NULL REFERENCES content.unit_versions (id) ON DELETE RESTRICT,
  objective_version_id uuid NOT NULL REFERENCES content.objective_versions (id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT true,
  PRIMARY KEY (unit_version_id, objective_version_id)
);

CREATE INDEX unit_objectives_objective_version_id_idx
  ON content.unit_objectives (objective_version_id);

CREATE TABLE content.objective_descriptors (
  objective_version_id uuid NOT NULL REFERENCES content.objective_versions (id) ON DELETE RESTRICT,
  descriptor_version_id uuid NOT NULL REFERENCES content.cefr_descriptor_versions (id) ON DELETE RESTRICT,
  PRIMARY KEY (objective_version_id, descriptor_version_id)
);

CREATE INDEX objective_descriptors_descriptor_version_id_idx
  ON content.objective_descriptors (descriptor_version_id);

CREATE TABLE content.unit_prerequisites (
  unit_version_id uuid NOT NULL REFERENCES content.unit_versions (id) ON DELETE RESTRICT,
  prerequisite_unit_version_id uuid NOT NULL REFERENCES content.unit_versions (id) ON DELETE RESTRICT,
  PRIMARY KEY (unit_version_id, prerequisite_unit_version_id),
  CONSTRAINT unit_prerequisites_no_self_ck CHECK (unit_version_id <> prerequisite_unit_version_id)
);

CREATE INDEX unit_prerequisites_prerequisite_unit_version_id_idx
  ON content.unit_prerequisites (prerequisite_unit_version_id);

CREATE TABLE content.lesson_versions (
  id uuid PRIMARY KEY,
  lesson_key varchar(80) NOT NULL,
  version integer NOT NULL,
  unit_key varchar(80) NOT NULL,
  title text NOT NULL,
  explanation jsonb NOT NULL,
  examples jsonb NOT NULL,
  completion_rule jsonb NOT NULL,
  estimated_minutes smallint NOT NULL,
  created_by uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_versions_version_ck CHECK (version > 0),
  CONSTRAINT lesson_versions_estimated_minutes_ck CHECK (estimated_minutes > 0),
  CONSTRAINT lesson_versions_lesson_key_version_key UNIQUE (lesson_key, version)
);

CREATE INDEX lesson_versions_created_by_idx ON content.lesson_versions (created_by);

CREATE TABLE content.unit_lessons (
  unit_version_id uuid NOT NULL REFERENCES content.unit_versions (id) ON DELETE RESTRICT,
  lesson_version_id uuid NOT NULL REFERENCES content.lesson_versions (id) ON DELETE RESTRICT,
  ordinal smallint NOT NULL,
  required boolean NOT NULL DEFAULT true,
  PRIMARY KEY (unit_version_id, lesson_version_id),
  CONSTRAINT unit_lessons_ordinal_ck CHECK (ordinal > 0),
  CONSTRAINT unit_lessons_unit_ordinal_key UNIQUE (unit_version_id, ordinal)
);

CREATE INDEX unit_lessons_lesson_version_id_idx ON content.unit_lessons (lesson_version_id);

CREATE TABLE content.activity_versions (
  id uuid PRIMARY KEY,
  activity_key varchar(100) NOT NULL,
  version integer NOT NULL,
  type content.activity_type NOT NULL,
  level learner.cefr_level NOT NULL,
  prompt jsonb NOT NULL,
  configuration jsonb NOT NULL,
  max_score numeric(8, 3) NOT NULL,
  required boolean NOT NULL DEFAULT true,
  transcript_policy content.transcript_policy NULL,
  created_by uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_versions_version_ck CHECK (version > 0),
  CONSTRAINT activity_versions_max_score_ck CHECK (max_score >= 0),
  CONSTRAINT activity_versions_listening_transcript_ck CHECK (
    type <> 'listening' OR transcript_policy IS NOT NULL
  ),
  CONSTRAINT activity_versions_activity_key_version_key UNIQUE (activity_key, version)
);

CREATE INDEX activity_versions_created_by_idx ON content.activity_versions (created_by);

CREATE TABLE content.lesson_activities (
  lesson_version_id uuid NOT NULL REFERENCES content.lesson_versions (id) ON DELETE RESTRICT,
  activity_version_id uuid NOT NULL REFERENCES content.activity_versions (id) ON DELETE RESTRICT,
  ordinal smallint NOT NULL,
  PRIMARY KEY (lesson_version_id, activity_version_id),
  CONSTRAINT lesson_activities_ordinal_ck CHECK (ordinal > 0),
  CONSTRAINT lesson_activities_lesson_ordinal_key UNIQUE (lesson_version_id, ordinal)
);

CREATE INDEX lesson_activities_activity_version_id_idx
  ON content.lesson_activities (activity_version_id);

CREATE TABLE content.activity_objectives (
  activity_version_id uuid NOT NULL REFERENCES content.activity_versions (id) ON DELETE RESTRICT,
  objective_version_id uuid NOT NULL REFERENCES content.objective_versions (id) ON DELETE RESTRICT,
  weight numeric(5, 4) NOT NULL,
  PRIMARY KEY (activity_version_id, objective_version_id),
  CONSTRAINT activity_objectives_weight_ck CHECK (weight > 0 AND weight <= 1)
);

CREATE TABLE content.activity_assets (
  activity_version_id uuid NOT NULL REFERENCES content.activity_versions (id) ON DELETE RESTRICT,
  media_object_id uuid NOT NULL REFERENCES media.objects (id) ON DELETE RESTRICT,
  purpose varchar(30) NOT NULL,
  ordinal smallint NOT NULL DEFAULT 1,
  alt_text text NULL,
  transcript jsonb NULL,
  PRIMARY KEY (activity_version_id, media_object_id),
  CONSTRAINT activity_assets_purpose_ck CHECK (purpose IN ('audio', 'image', 'attachment')),
  CONSTRAINT activity_assets_ordinal_ck CHECK (ordinal > 0),
  CONSTRAINT activity_assets_purpose_ordinal_key UNIQUE (activity_version_id, purpose, ordinal)
);

CREATE INDEX activity_assets_media_object_id_idx ON content.activity_assets (media_object_id);

CREATE TABLE content.answer_key_versions (
  id uuid PRIMARY KEY,
  activity_version_id uuid NOT NULL REFERENCES content.activity_versions (id) ON DELETE RESTRICT,
  version integer NOT NULL,
  scoring_algorithm_version varchar(40) NOT NULL,
  answer_spec jsonb NOT NULL,
  rationale jsonb NOT NULL,
  max_score numeric(8, 3) NOT NULL,
  created_by uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT answer_key_versions_version_ck CHECK (version > 0),
  CONSTRAINT answer_key_versions_max_score_ck CHECK (max_score >= 0),
  CONSTRAINT answer_key_versions_activity_version_key UNIQUE (activity_version_id, version)
);

CREATE INDEX answer_key_versions_created_by_idx ON content.answer_key_versions (created_by);

CREATE TABLE content.rubric_versions (
  id uuid PRIMARY KEY,
  rubric_key varchar(100) NOT NULL,
  version integer NOT NULL,
  activity_version_id uuid NULL REFERENCES content.activity_versions (id) ON DELETE RESTRICT,
  dimensions jsonb NOT NULL,
  scoring_rule jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rubric_versions_version_ck CHECK (version > 0),
  CONSTRAINT rubric_versions_rubric_key_version_key UNIQUE (rubric_key, version)
);

CREATE INDEX rubric_versions_activity_version_id_idx ON content.rubric_versions (activity_version_id);
CREATE INDEX rubric_versions_created_by_idx ON content.rubric_versions (created_by);

CREATE TABLE content.review_events (
  id uuid PRIMARY KEY,
  aggregate_type varchar(30) NOT NULL,
  aggregate_id uuid NOT NULL,
  action varchar(20) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  qualification text NULL,
  validation_result jsonb NOT NULL,
  comment text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_events_action_ck CHECK (
    action IN (
      'submitted',
      'approved',
      'rejected',
      'published',
      'retired',
      'rollback_selected'
    )
  )
);

CREATE INDEX review_events_actor_user_id_idx ON content.review_events (actor_user_id);
CREATE INDEX review_events_aggregate_idx ON content.review_events (aggregate_type, aggregate_id);
