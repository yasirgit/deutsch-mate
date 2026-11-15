-- DM-031: allow retired → published when selecting a prior release for rollback.
-- Content rows remain immutable; only status/retired_at (and publish actor stamps) flip.
-- Still forbids DELETE on published/retired and other published-row mutations.

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
    -- Forward: published → retired
    IF OLD.status = 'published'
      AND NEW.status = 'retired'
      AND NEW.retired_at IS NOT NULL
    THEN
      RETURN NEW;
    END IF;
    -- Rollback reselection: retired → published (clears retired_at)
    IF OLD.status = 'retired'
      AND NEW.status = 'published'
      AND NEW.retired_at IS NULL
      AND NEW.published_at IS NOT NULL
      AND NEW.published_by IS NOT NULL
      AND NEW.approved_at IS NOT NULL
      AND NEW.approved_by IS NOT NULL
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

COMMENT ON FUNCTION ops.forbid_released_mutation() IS
  'Allows draft/approved mutation, published→retired, and retired→published rollback reselection; otherwise denies UPDATE/DELETE without maintenance ticket (Database.md §7; DM-031).';
