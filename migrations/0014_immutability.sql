-- DM-021: immutability / append-only enforcement (docs/Database.md §7).
-- Bypass only with SET LOCAL app.maintenance_ticket in an audited maintenance txn.

CREATE OR REPLACE FUNCTION ops.forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ticket text;
BEGIN
  ticket := nullif(current_setting('app.maintenance_ticket', true), '');
  IF ticket IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'dm_forbid_mutation: % on %.% is denied (append-only / immutable)',
    TG_OP,
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

COMMENT ON FUNCTION ops.forbid_mutation() IS
  'Denies UPDATE/DELETE unless app.maintenance_ticket is set (Database.md §7).';

-- Published release rows: allow draft→approved→published; allow published→retired;
-- otherwise deny UPDATE/DELETE without maintenance ticket.
CREATE OR REPLACE FUNCTION ops.forbid_released_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ticket text;
BEGIN
  ticket := nullif(current_setting('app.maintenance_ticket', true), '');
  IF ticket IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published', 'retired') THEN
      RAISE EXCEPTION
        'dm_forbid_mutation: DELETE on published/retired %.% is denied',
        TG_TABLE_SCHEMA,
        TG_TABLE_NAME
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('published', 'retired') THEN
    IF OLD.status = 'published'
      AND NEW.status = 'retired'
      AND NEW.retired_at IS NOT NULL
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'dm_forbid_mutation: UPDATE on published/retired %.% is denied',
      TG_TABLE_SCHEMA,
      TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

-- Content mapping tables: immutable once referenced by a published/retired release.
CREATE OR REPLACE FUNCTION ops.forbid_published_content_mapping()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ticket text;
  blocked boolean := false;
BEGIN
  ticket := nullif(current_setting('app.maintenance_ticket', true), '');
  IF ticket IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'release_modules' THEN
    SELECT EXISTS (
      SELECT 1
      FROM content.curriculum_releases r
      WHERE r.id = COALESCE(NEW.release_id, OLD.release_id)
        AND r.status IN ('published', 'retired')
    )
    INTO blocked;
  ELSIF TG_TABLE_NAME = 'module_units' THEN
    SELECT EXISTS (
      SELECT 1
      FROM content.release_modules rm
      JOIN content.curriculum_releases r ON r.id = rm.release_id
      WHERE rm.module_version_id = COALESCE(NEW.module_version_id, OLD.module_version_id)
        AND r.status IN ('published', 'retired')
    )
    INTO blocked;
  ELSIF TG_TABLE_NAME IN (
    'unit_objectives',
    'unit_lessons',
    'unit_prerequisites'
  ) THEN
    SELECT EXISTS (
      SELECT 1
      FROM content.module_units mu
      JOIN content.release_modules rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases r ON r.id = rm.release_id
      WHERE mu.unit_version_id = COALESCE(NEW.unit_version_id, OLD.unit_version_id)
        AND r.status IN ('published', 'retired')
    )
    INTO blocked;
  ELSIF TG_TABLE_NAME = 'objective_descriptors' THEN
    SELECT EXISTS (
      SELECT 1
      FROM content.unit_objectives uo
      JOIN content.module_units mu ON mu.unit_version_id = uo.unit_version_id
      JOIN content.release_modules rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases r ON r.id = rm.release_id
      WHERE uo.objective_version_id = COALESCE(
        NEW.objective_version_id,
        OLD.objective_version_id
      )
        AND r.status IN ('published', 'retired')
    )
    INTO blocked;
  ELSIF TG_TABLE_NAME = 'lesson_activities' THEN
    SELECT EXISTS (
      SELECT 1
      FROM content.unit_lessons ul
      JOIN content.module_units mu ON mu.unit_version_id = ul.unit_version_id
      JOIN content.release_modules rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases r ON r.id = rm.release_id
      WHERE ul.lesson_version_id = COALESCE(NEW.lesson_version_id, OLD.lesson_version_id)
        AND r.status IN ('published', 'retired')
    )
    INTO blocked;
  ELSIF TG_TABLE_NAME IN ('activity_objectives', 'activity_assets') THEN
    SELECT EXISTS (
      SELECT 1
      FROM content.lesson_activities la
      JOIN content.unit_lessons ul ON ul.lesson_version_id = la.lesson_version_id
      JOIN content.module_units mu ON mu.unit_version_id = ul.unit_version_id
      JOIN content.release_modules rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases r ON r.id = rm.release_id
      WHERE la.activity_version_id = COALESCE(
        NEW.activity_version_id,
        OLD.activity_version_id
      )
        AND r.status IN ('published', 'retired')
    )
    INTO blocked;
  END IF;

  IF blocked THEN
    RAISE EXCEPTION
      'dm_forbid_mutation: % on published content mapping %.% is denied',
      TG_OP,
      TG_TABLE_SCHEMA,
      TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Append-only / immutable tables
DO $$
DECLARE
  rel text;
  tables text[] := ARRAY[
    'iam.legal_document_versions',
    'iam.consent_events',
    'learner.profile_versions',
    'learner.proficiency_snapshots',
    'content.module_versions',
    'content.unit_versions',
    'content.objective_versions',
    'content.cefr_descriptor_versions',
    'content.lesson_versions',
    'content.activity_versions',
    'content.answer_key_versions',
    'content.rubric_versions',
    'content.review_events',
    'learning.activity_attempts',
    'learning.attempt_responses',
    'learning.attempt_scores',
    'learning.feedback_records',
    'learning.evidence',
    'learning.recommendation_runs',
    'ai.prompt_versions',
    'ai.model_config_versions',
    'ai.trace_events',
    'ai.langgraph_checkpoints',
    'billing.plan_prices',
    'billing.plan_features',
    'billing.entitlement_events',
    'billing.usage_events',
    'billing.reconciliation_items',
    'privacy.request_events',
    'support.case_events',
    'ops.audit_events'
  ];
BEGIN
  FOREACH rel IN ARRAY tables LOOP
    EXECUTE format(
      'CREATE TRIGGER forbid_mutation_upd BEFORE UPDATE ON %s
       FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation()',
      rel
    );
    EXECUTE format(
      'CREATE TRIGGER forbid_mutation_del BEFORE DELETE ON %s
       FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation()',
      rel
    );
  END LOOP;
END
$$;

-- Published release state machines
CREATE TRIGGER forbid_released_mutation_upd
  BEFORE UPDATE ON content.curriculum_releases
  FOR EACH ROW EXECUTE FUNCTION ops.forbid_released_mutation();
CREATE TRIGGER forbid_released_mutation_del
  BEFORE DELETE ON content.curriculum_releases
  FOR EACH ROW EXECUTE FUNCTION ops.forbid_released_mutation();

CREATE TRIGGER forbid_released_mutation_upd
  BEFORE UPDATE ON ai.releases
  FOR EACH ROW EXECUTE FUNCTION ops.forbid_released_mutation();
CREATE TRIGGER forbid_released_mutation_del
  BEFORE DELETE ON ai.releases
  FOR EACH ROW EXECUTE FUNCTION ops.forbid_released_mutation();

-- Content mapping tables
DO $$
DECLARE
  rel text;
  tables text[] := ARRAY[
    'content.release_modules',
    'content.module_units',
    'content.unit_objectives',
    'content.objective_descriptors',
    'content.unit_prerequisites',
    'content.unit_lessons',
    'content.lesson_activities',
    'content.activity_objectives',
    'content.activity_assets'
  ];
BEGIN
  FOREACH rel IN ARRAY tables LOOP
    EXECUTE format(
      'CREATE TRIGGER forbid_published_mapping_upd BEFORE UPDATE ON %s
       FOR EACH ROW EXECUTE FUNCTION ops.forbid_published_content_mapping()',
      rel
    );
    EXECUTE format(
      'CREATE TRIGGER forbid_published_mapping_del BEFORE DELETE ON %s
       FOR EACH ROW EXECUTE FUNCTION ops.forbid_published_content_mapping()',
      rel
    );
  END LOOP;
END
$$;
