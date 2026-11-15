-- DM-021: learning.feedback_records after ai.runs (docs/Database.md §4.5).

CREATE TABLE learning.feedback_records (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES learning.activity_attempts (id) ON DELETE RESTRICT,
  ai_run_id uuid NULL REFERENCES ai.runs (id) ON DELETE RESTRICT,
  feedback_kind varchar(20) NOT NULL,
  corrected_text text NULL,
  feedback jsonb NOT NULL,
  learner_disposition varchar(20) NULL,
  content_expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_records_kind_ck CHECK (
    feedback_kind IN ('deterministic', 'ai', 'unavailable')
  ),
  CONSTRAINT feedback_records_disposition_ck CHECK (
    learner_disposition IS NULL
    OR learner_disposition IN ('accepted', 'retried', 'dismissed')
  )
);

CREATE INDEX feedback_records_attempt_id_idx ON learning.feedback_records (attempt_id);
CREATE INDEX feedback_records_ai_run_id_idx ON learning.feedback_records (ai_run_id);
