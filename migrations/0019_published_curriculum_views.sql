-- DM-032: published-only curriculum membership views for learner delivery.
-- Extends 0016 public content views (Database.md §8).

CREATE OR REPLACE VIEW content.v_published_module_versions
WITH (security_barrier = true, security_invoker = true) AS
SELECT mv.*
FROM content.module_versions AS mv
WHERE EXISTS (
  SELECT 1
  FROM content.release_modules AS rm
  JOIN content.curriculum_releases AS r ON r.id = rm.release_id
  WHERE rm.module_version_id = mv.id
    AND r.status = 'published'
);

CREATE OR REPLACE VIEW content.v_published_lesson_versions
WITH (security_barrier = true, security_invoker = true) AS
SELECT lv.*
FROM content.lesson_versions AS lv
WHERE EXISTS (
  SELECT 1
  FROM content.unit_lessons AS ul
  JOIN content.module_units AS mu ON mu.unit_version_id = ul.unit_version_id
  JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
  JOIN content.curriculum_releases AS r ON r.id = rm.release_id
  WHERE ul.lesson_version_id = lv.id
    AND r.status = 'published'
);

CREATE OR REPLACE VIEW content.v_published_activity_versions
WITH (security_barrier = true, security_invoker = true) AS
SELECT av.*
FROM content.activity_versions AS av
WHERE EXISTS (
  SELECT 1
  FROM content.lesson_activities AS la
  JOIN content.unit_lessons AS ul ON ul.lesson_version_id = la.lesson_version_id
  JOIN content.module_units AS mu ON mu.unit_version_id = ul.unit_version_id
  JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
  JOIN content.curriculum_releases AS r ON r.id = rm.release_id
  WHERE la.activity_version_id = av.id
    AND r.status = 'published'
);

GRANT SELECT ON content.v_published_module_versions TO dm_api;
GRANT SELECT ON content.v_published_lesson_versions TO dm_api;
GRANT SELECT ON content.v_published_activity_versions TO dm_api;

GRANT SELECT ON content.v_published_module_versions TO dm_ai_worker;
GRANT SELECT ON content.v_published_lesson_versions TO dm_ai_worker;
GRANT SELECT ON content.v_published_activity_versions TO dm_ai_worker;

COMMENT ON VIEW content.v_published_module_versions IS
  'Module versions referenced by a published curriculum release (DM-032).';
COMMENT ON VIEW content.v_published_lesson_versions IS
  'Lesson versions reachable from a published curriculum release (DM-032).';
COMMENT ON VIEW content.v_published_activity_versions IS
  'Activity versions reachable from a published curriculum release (DM-032).';

-- Learners may read content-type / registry metadata for assets linked to the
-- published curriculum graph (never bucket/object keys via API). Platform
-- curriculum assets use owner_user_id IS NULL.
CREATE POLICY media_objects_published_content_select ON media.objects
  FOR SELECT TO dm_api
  USING (
    owner_user_id IS NULL
    AND ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.activity_assets AS aa
      JOIN content.lesson_activities AS la ON la.activity_version_id = aa.activity_version_id
      JOIN content.unit_lessons AS ul ON ul.lesson_version_id = la.lesson_version_id
      JOIN content.module_units AS mu ON mu.unit_version_id = ul.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE aa.media_object_id = objects.id
        AND r.status = 'published'
    )
  );
