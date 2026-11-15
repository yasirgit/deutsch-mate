-- DM-022: RLS, capability helpers, published views, least-privilege grants
-- (docs/Database.md §8; CODING_STANDARDS §10).
-- Deny-by-default: ENABLE + FORCE RLS on user-owned and child-owned tables.
-- admin is never an RLS bypass. Runtime roles never own tables / never BYPASSRLS.

-- ---------------------------------------------------------------------------
-- 1. Security-definer owner grants (role created in 0001; schemas owned by
--    session owner so grants run with RESET ROLE)
-- ---------------------------------------------------------------------------
RESET ROLE;
REVOKE ALL ON SCHEMA iam FROM dm_security;
GRANT USAGE ON SCHEMA iam TO dm_security;
GRANT SELECT ON TABLE iam.users TO dm_security;
GRANT SELECT ON TABLE iam.user_roles TO dm_security;
SET LOCAL ROLE dm_migrator;

-- ---------------------------------------------------------------------------
-- 2. Session / capability helpers (reject caller-supplied user IDs)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.session_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION ops.session_user_id() IS
  'Transaction-local app.user_id; never accepts a caller-supplied user id.';

CREATE OR REPLACE FUNCTION ops.app_claims_role(p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT position(
    ',' || p_role || ',' IN
    ',' || coalesce(nullif(current_setting('app.roles', true), ''), '') || ','
  ) > 0;
$$;

COMMENT ON FUNCTION ops.app_claims_role(text) IS
  'True when p_role appears in comma-separated app.roles (SET LOCAL).';

CREATE OR REPLACE FUNCTION ops.session_user_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM iam.users AS u
    WHERE u.id = nullif(current_setting('app.user_id', true), '')::uuid
      AND u.status = 'active'::iam.account_status
  );
$$;

CREATE OR REPLACE FUNCTION ops.has_active_role(p_role iam.role_code)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$
  SELECT
    nullif(current_setting('app.user_id', true), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM iam.users AS u
      WHERE u.id = nullif(current_setting('app.user_id', true), '')::uuid
        AND u.status = 'active'::iam.account_status
    )
    AND EXISTS (
      SELECT 1
      FROM iam.user_roles AS r
      WHERE r.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        AND r.role = p_role
        AND r.revoked_at IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION ops.staff_capability(p_role iam.role_code)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT ops.has_active_role(p_role) AND ops.app_claims_role(p_role::text);
$$;

COMMENT ON FUNCTION ops.staff_capability(iam.role_code) IS
  'Active iam.user_roles grant AND matching app.roles claim; admin is not implied.';

-- Ownership transfer requires session user (not dm_migrator).
RESET ROLE;
ALTER FUNCTION ops.session_user_is_active() OWNER TO dm_security;
ALTER FUNCTION ops.has_active_role(iam.role_code) OWNER TO dm_security;
SET LOCAL ROLE dm_migrator;

REVOKE ALL ON FUNCTION ops.session_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.app_claims_role(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.session_user_is_active() FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.has_active_role(iam.role_code) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.staff_capability(iam.role_code) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION ops.session_user_id() TO dm_api, dm_ai_worker, dm_billing_worker,
  dm_media_worker, dm_privacy_worker, dm_outbox_worker, dm_read_replica;
GRANT EXECUTE ON FUNCTION ops.app_claims_role(text) TO dm_api, dm_ai_worker, dm_billing_worker,
  dm_media_worker, dm_privacy_worker, dm_outbox_worker, dm_read_replica;
GRANT EXECUTE ON FUNCTION ops.session_user_is_active() TO dm_api, dm_ai_worker, dm_billing_worker,
  dm_media_worker, dm_privacy_worker, dm_outbox_worker, dm_read_replica;
GRANT EXECUTE ON FUNCTION ops.has_active_role(iam.role_code) TO dm_api, dm_ai_worker,
  dm_billing_worker, dm_media_worker, dm_privacy_worker, dm_outbox_worker, dm_read_replica;
GRANT EXECUTE ON FUNCTION ops.staff_capability(iam.role_code) TO dm_api, dm_ai_worker,
  dm_billing_worker, dm_media_worker, dm_privacy_worker, dm_outbox_worker, dm_read_replica;

-- ---------------------------------------------------------------------------
-- 3. ENABLE + FORCE RLS on user-owned and child-owned tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rel text;
  targets text[] := ARRAY[
    -- direct user_id / owner_user_id / self
    'iam.users',
    'iam.user_identities',
    'iam.user_roles',
    'iam.consent_events',
    'learner.profile_versions',
    'learner.onboarding_states',
    'learner.proficiency_snapshots',
    'media.objects',
    'learning.sessions',
    'learning.activity_attempts',
    'learning.attempt_responses',
    'learning.attempt_scores',
    'learning.feedback_records',
    'learning.evidence',
    'learning.review_items',
    'learning.recommendation_runs',
    'learning.unit_progress',
    'ai.threads',
    'ai.runs',
    'ai.messages',
    'ai.trace_events',
    'ai.langgraph_checkpoints',
    'ai.langgraph_writes',
    'billing.customers',
    'billing.checkout_sessions',
    'billing.subscriptions',
    'billing.entitlements',
    'billing.entitlement_events',
    'billing.usage_events',
    'privacy.requests',
    'privacy.request_events',
    'privacy.erasure_tasks',
    'support.cases',
    'support.case_events',
    'ops.idempotency_keys',
    'ops.audit_events',
    -- content (draft deny-by-default; published via policy/views)
    'content.curriculum_releases',
    'content.module_versions',
    'content.release_modules',
    'content.unit_versions',
    'content.module_units',
    'content.objective_versions',
    'content.cefr_descriptor_versions',
    'content.unit_objectives',
    'content.objective_descriptors',
    'content.unit_prerequisites',
    'content.lesson_versions',
    'content.unit_lessons',
    'content.activity_versions',
    'content.lesson_activities',
    'content.activity_objectives',
    'content.activity_assets',
    'content.answer_key_versions',
    'content.rubric_versions',
    'content.review_events',
    -- staff-authored registries
    'iam.legal_document_versions',
    'ai.prompt_versions',
    'ai.model_config_versions',
    'ai.releases'
  ];
BEGIN
  FOREACH rel IN ARRAY targets LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', rel);
  END LOOP;
END
$$;

-- Catalog / ops ledgers without user ownership: grants-only (no FORCE RLS required).
-- billing.plans, plan_prices, plan_features, webhook_events, reconciliation_*
-- ops.outbox_events, ops.inbox_events, ops.schema_migrations

-- ---------------------------------------------------------------------------
-- 4. Learner / owner policies (dm_api)
-- ---------------------------------------------------------------------------

-- iam.users: self only while active (deletion_pending denies access)
CREATE POLICY users_self_select ON iam.users
  FOR SELECT TO dm_api
  USING (id = ops.session_user_id() AND status = 'active'::iam.account_status);

CREATE POLICY users_self_update ON iam.users
  FOR UPDATE TO dm_api
  USING (id = ops.session_user_id() AND status = 'active'::iam.account_status)
  WITH CHECK (id = ops.session_user_id());

CREATE POLICY users_self_insert ON iam.users
  FOR INSERT TO dm_api
  WITH CHECK (id = ops.session_user_id());

-- Privacy worker may read/update accounts under erasure
CREATE POLICY users_privacy_worker ON iam.users
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY user_identities_owner ON iam.user_identities
  FOR ALL TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active())
  WITH CHECK (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY user_identities_privacy_worker ON iam.user_identities
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

-- Roles: learners read own; only admin+claim may manage grants (not a data bypass)
CREATE POLICY user_roles_self_select ON iam.user_roles
  FOR SELECT TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY user_roles_admin_manage ON iam.user_roles
  FOR ALL TO dm_api
  USING (ops.staff_capability('admin'::iam.role_code))
  WITH CHECK (ops.staff_capability('admin'::iam.role_code));

CREATE POLICY user_roles_privacy_worker ON iam.user_roles
  FOR SELECT TO dm_privacy_worker
  USING (true);

CREATE POLICY consent_events_owner ON iam.consent_events
  FOR ALL TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active())
  WITH CHECK (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY consent_events_privacy_worker ON iam.consent_events
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY legal_docs_authenticated_select ON iam.legal_document_versions
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    OR ops.staff_capability('admin'::iam.role_code)
    OR ops.staff_capability('privacy_operator'::iam.role_code)
  );

CREATE POLICY legal_docs_staff_write ON iam.legal_document_versions
  FOR INSERT TO dm_api
  WITH CHECK (
    ops.staff_capability('admin'::iam.role_code)
    OR ops.staff_capability('privacy_operator'::iam.role_code)
  );

CREATE POLICY profile_versions_owner ON learner.profile_versions
  FOR ALL TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active())
  WITH CHECK (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY profile_versions_ai_worker_select ON learner.profile_versions
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY profile_versions_privacy_worker ON learner.profile_versions
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY onboarding_states_owner ON learner.onboarding_states
  FOR ALL TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active())
  WITH CHECK (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY onboarding_states_privacy_worker ON learner.onboarding_states
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY proficiency_snapshots_owner ON learner.proficiency_snapshots
  FOR ALL TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active())
  WITH CHECK (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY proficiency_snapshots_ai_worker_select ON learner.proficiency_snapshots
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY proficiency_snapshots_privacy_worker ON learner.proficiency_snapshots
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

-- media.objects: owner_user_id match; null owner = platform asset (staff/media worker)
CREATE POLICY media_objects_owner ON media.objects
  FOR ALL TO dm_api
  USING (
    (
      owner_user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR (
      owner_user_id IS NULL
      AND (
        ops.staff_capability('content_editor'::iam.role_code)
        OR ops.staff_capability('content_reviewer'::iam.role_code)
        OR ops.staff_capability('admin'::iam.role_code)
      )
    )
  )
  WITH CHECK (
    (
      owner_user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR (
      owner_user_id IS NULL
      AND (
        ops.staff_capability('content_editor'::iam.role_code)
        OR ops.staff_capability('admin'::iam.role_code)
      )
    )
  );

CREATE POLICY media_objects_media_worker ON media.objects
  FOR ALL TO dm_media_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY media_objects_privacy_worker ON media.objects
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

-- learning direct ownership
CREATE POLICY sessions_owner ON learning.sessions
  FOR ALL TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active())
  WITH CHECK (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY sessions_ai_worker ON learning.sessions
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY sessions_privacy_worker ON learning.sessions
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY activity_attempts_owner ON learning.activity_attempts
  FOR ALL TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active())
  WITH CHECK (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY activity_attempts_ai_worker ON learning.activity_attempts
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY activity_attempts_privacy_worker ON learning.activity_attempts
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY attempt_responses_via_parent ON learning.attempt_responses
  FOR ALL TO dm_api
  USING (
    EXISTS (
      SELECT 1
      FROM learning.activity_attempts AS a
      WHERE a.id = attempt_responses.attempt_id
        AND a.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM learning.activity_attempts AS a
      WHERE a.id = attempt_responses.attempt_id
        AND a.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  );

CREATE POLICY attempt_responses_ai_worker ON learning.attempt_responses
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY attempt_responses_privacy_worker ON learning.attempt_responses
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY attempt_scores_via_parent ON learning.attempt_scores
  FOR ALL TO dm_api
  USING (
    EXISTS (
      SELECT 1
      FROM learning.activity_attempts AS a
      WHERE a.id = attempt_scores.attempt_id
        AND a.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM learning.activity_attempts AS a
      WHERE a.id = attempt_scores.attempt_id
        AND a.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  );

CREATE POLICY attempt_scores_ai_worker ON learning.attempt_scores
  FOR ALL TO dm_ai_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY attempt_scores_privacy_worker ON learning.attempt_scores
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY feedback_records_via_parent ON learning.feedback_records
  FOR ALL TO dm_api
  USING (
    EXISTS (
      SELECT 1
      FROM learning.activity_attempts AS a
      WHERE a.id = feedback_records.attempt_id
        AND a.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM learning.activity_attempts AS a
      WHERE a.id = feedback_records.attempt_id
        AND a.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  );

CREATE POLICY feedback_records_ai_worker ON learning.feedback_records
  FOR ALL TO dm_ai_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY feedback_records_privacy_worker ON learning.feedback_records
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY evidence_owner ON learning.evidence
  FOR ALL TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active())
  WITH CHECK (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY evidence_ai_worker ON learning.evidence
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY evidence_privacy_worker ON learning.evidence
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY review_items_owner ON learning.review_items
  FOR ALL TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active())
  WITH CHECK (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY review_items_ai_worker ON learning.review_items
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY review_items_privacy_worker ON learning.review_items
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY recommendation_runs_owner ON learning.recommendation_runs
  FOR ALL TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active())
  WITH CHECK (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY recommendation_runs_ai_worker ON learning.recommendation_runs
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY recommendation_runs_privacy_worker ON learning.recommendation_runs
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY unit_progress_owner ON learning.unit_progress
  FOR ALL TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active())
  WITH CHECK (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY unit_progress_ai_worker ON learning.unit_progress
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY unit_progress_privacy_worker ON learning.unit_progress
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

-- AI user-owned + children
CREATE POLICY threads_owner ON ai.threads
  FOR ALL TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active())
  WITH CHECK (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY threads_ai_worker ON ai.threads
  FOR ALL TO dm_ai_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY threads_privacy_worker ON ai.threads
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY runs_owner ON ai.runs
  FOR ALL TO dm_api
  USING (user_id = ops.session_user_id() AND ops.session_user_is_active())
  WITH CHECK (user_id = ops.session_user_id() AND ops.session_user_is_active());

CREATE POLICY runs_ai_worker ON ai.runs
  FOR ALL TO dm_ai_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY runs_privacy_worker ON ai.runs
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY messages_via_parent ON ai.messages
  FOR ALL TO dm_api
  USING (
    EXISTS (
      SELECT 1
      FROM ai.runs AS r
      WHERE r.id = messages.run_id
        AND r.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ai.runs AS r
      WHERE r.id = messages.run_id
        AND r.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  );

CREATE POLICY messages_ai_worker ON ai.messages
  FOR ALL TO dm_ai_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY messages_privacy_worker ON ai.messages
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY trace_events_via_parent ON ai.trace_events
  FOR ALL TO dm_api
  USING (
    EXISTS (
      SELECT 1
      FROM ai.runs AS r
      WHERE r.id = trace_events.run_id
        AND r.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ai.runs AS r
      WHERE r.id = trace_events.run_id
        AND r.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  );

CREATE POLICY trace_events_ai_worker ON ai.trace_events
  FOR ALL TO dm_ai_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY langgraph_checkpoints_via_parent ON ai.langgraph_checkpoints
  FOR ALL TO dm_api
  USING (
    EXISTS (
      SELECT 1
      FROM ai.threads AS t
      WHERE t.id = langgraph_checkpoints.thread_id
        AND t.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ai.threads AS t
      WHERE t.id = langgraph_checkpoints.thread_id
        AND t.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  );

CREATE POLICY langgraph_checkpoints_ai_worker ON ai.langgraph_checkpoints
  FOR ALL TO dm_ai_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY langgraph_checkpoints_privacy_worker ON ai.langgraph_checkpoints
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY langgraph_writes_via_parent ON ai.langgraph_writes
  FOR ALL TO dm_api
  USING (
    EXISTS (
      SELECT 1
      FROM ai.threads AS t
      WHERE t.id = langgraph_writes.thread_id
        AND t.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ai.threads AS t
      WHERE t.id = langgraph_writes.thread_id
        AND t.user_id = ops.session_user_id()
        AND ops.session_user_is_active()
    )
  );

CREATE POLICY langgraph_writes_ai_worker ON ai.langgraph_writes
  FOR ALL TO dm_ai_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY langgraph_writes_privacy_worker ON ai.langgraph_writes
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

-- AI registries: staff write; published select for authenticated
CREATE POLICY prompt_versions_staff ON ai.prompt_versions
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
    OR ops.staff_capability('admin'::iam.role_code)
  )
  WITH CHECK (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('admin'::iam.role_code)
  );

CREATE POLICY prompt_versions_published_select ON ai.prompt_versions
  FOR SELECT TO dm_api
  USING (status = 'published' AND ops.session_user_is_active());

CREATE POLICY prompt_versions_ai_worker ON ai.prompt_versions
  FOR SELECT TO dm_ai_worker
  USING (status = 'published');

CREATE POLICY model_config_versions_staff ON ai.model_config_versions
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
    OR ops.staff_capability('admin'::iam.role_code)
  )
  WITH CHECK (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('admin'::iam.role_code)
  );

CREATE POLICY model_config_versions_ai_worker ON ai.model_config_versions
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY ai_releases_staff ON ai.releases
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
    OR ops.staff_capability('admin'::iam.role_code)
  )
  WITH CHECK (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
    OR ops.staff_capability('admin'::iam.role_code)
  );

CREATE POLICY ai_releases_published_select ON ai.releases
  FOR SELECT TO dm_api
  USING (status = 'published' AND ops.session_user_is_active());

CREATE POLICY ai_releases_ai_worker ON ai.releases
  FOR SELECT TO dm_ai_worker
  USING (status = 'published');

-- Billing user-owned
CREATE POLICY customers_owner ON billing.customers
  FOR ALL TO dm_api
  USING (
    (
      user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR ops.staff_capability('billing_operator'::iam.role_code)
  )
  WITH CHECK (
    (
      user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR ops.staff_capability('billing_operator'::iam.role_code)
  );

CREATE POLICY customers_billing_worker ON billing.customers
  FOR ALL TO dm_billing_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY customers_privacy_worker ON billing.customers
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY checkout_sessions_owner ON billing.checkout_sessions
  FOR ALL TO dm_api
  USING (
    (
      user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR ops.staff_capability('billing_operator'::iam.role_code)
  )
  WITH CHECK (
    (
      user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR ops.staff_capability('billing_operator'::iam.role_code)
  );

CREATE POLICY checkout_sessions_billing_worker ON billing.checkout_sessions
  FOR ALL TO dm_billing_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY subscriptions_via_parent ON billing.subscriptions
  FOR ALL TO dm_api
  USING (
    EXISTS (
      SELECT 1
      FROM billing.customers AS c
      WHERE c.id = subscriptions.customer_id
        AND (
          (
            c.user_id = ops.session_user_id()
            AND ops.session_user_is_active()
          )
          OR ops.staff_capability('billing_operator'::iam.role_code)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM billing.customers AS c
      WHERE c.id = subscriptions.customer_id
        AND (
          (
            c.user_id = ops.session_user_id()
            AND ops.session_user_is_active()
          )
          OR ops.staff_capability('billing_operator'::iam.role_code)
        )
    )
  );

CREATE POLICY subscriptions_billing_worker ON billing.subscriptions
  FOR ALL TO dm_billing_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY entitlements_owner ON billing.entitlements
  FOR ALL TO dm_api
  USING (
    (
      user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR ops.staff_capability('billing_operator'::iam.role_code)
  )
  WITH CHECK (
    (
      user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR ops.staff_capability('billing_operator'::iam.role_code)
  );

CREATE POLICY entitlements_billing_worker ON billing.entitlements
  FOR ALL TO dm_billing_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY entitlements_privacy_worker ON billing.entitlements
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY entitlement_events_via_parent ON billing.entitlement_events
  FOR ALL TO dm_api
  USING (
    EXISTS (
      SELECT 1
      FROM billing.entitlements AS e
      WHERE e.id = entitlement_events.entitlement_id
        AND (
          (
            e.user_id = ops.session_user_id()
            AND ops.session_user_is_active()
          )
          OR ops.staff_capability('billing_operator'::iam.role_code)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM billing.entitlements AS e
      WHERE e.id = entitlement_events.entitlement_id
        AND (
          (
            e.user_id = ops.session_user_id()
            AND ops.session_user_is_active()
          )
          OR ops.staff_capability('billing_operator'::iam.role_code)
        )
    )
  );

CREATE POLICY entitlement_events_billing_worker ON billing.entitlement_events
  FOR ALL TO dm_billing_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY usage_events_owner ON billing.usage_events
  FOR ALL TO dm_api
  USING (
    (
      user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR ops.staff_capability('billing_operator'::iam.role_code)
  )
  WITH CHECK (
    (
      user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR ops.staff_capability('billing_operator'::iam.role_code)
  );

CREATE POLICY usage_events_billing_worker ON billing.usage_events
  FOR ALL TO dm_billing_worker
  USING (true)
  WITH CHECK (true);

-- Privacy / support
CREATE POLICY privacy_requests_owner ON privacy.requests
  FOR ALL TO dm_api
  USING (
    (
      user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR ops.staff_capability('privacy_operator'::iam.role_code)
  )
  WITH CHECK (
    (
      user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR ops.staff_capability('privacy_operator'::iam.role_code)
  );

CREATE POLICY privacy_requests_privacy_worker ON privacy.requests
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY privacy_request_events_via_parent ON privacy.request_events
  FOR ALL TO dm_api
  USING (
    EXISTS (
      SELECT 1
      FROM privacy.requests AS r
      WHERE r.id = request_events.request_id
        AND (
          (
            r.user_id = ops.session_user_id()
            AND ops.session_user_is_active()
          )
          OR ops.staff_capability('privacy_operator'::iam.role_code)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM privacy.requests AS r
      WHERE r.id = request_events.request_id
        AND (
          (
            r.user_id = ops.session_user_id()
            AND ops.session_user_is_active()
          )
          OR ops.staff_capability('privacy_operator'::iam.role_code)
        )
    )
  );

CREATE POLICY privacy_request_events_privacy_worker ON privacy.request_events
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY privacy_erasure_tasks_via_parent ON privacy.erasure_tasks
  FOR ALL TO dm_api
  USING (
    EXISTS (
      SELECT 1
      FROM privacy.requests AS r
      WHERE r.id = erasure_tasks.request_id
        AND (
          (
            r.user_id = ops.session_user_id()
            AND ops.session_user_is_active()
          )
          OR ops.staff_capability('privacy_operator'::iam.role_code)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM privacy.requests AS r
      WHERE r.id = erasure_tasks.request_id
        AND ops.staff_capability('privacy_operator'::iam.role_code)
    )
  );

CREATE POLICY privacy_erasure_tasks_privacy_worker ON privacy.erasure_tasks
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY support_cases_owner ON support.cases
  FOR ALL TO dm_api
  USING (
    (
      user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR (
      ops.staff_capability('support'::iam.role_code)
      AND (
        assigned_to = ops.session_user_id()
        OR assigned_to IS NULL
      )
    )
  )
  WITH CHECK (
    (
      user_id = ops.session_user_id()
      AND ops.session_user_is_active()
    )
    OR ops.staff_capability('support'::iam.role_code)
  );

CREATE POLICY support_cases_privacy_worker ON support.cases
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY support_case_events_via_parent ON support.case_events
  FOR ALL TO dm_api
  USING (
    EXISTS (
      SELECT 1
      FROM support.cases AS c
      WHERE c.id = case_events.case_id
        AND (
          (
            c.user_id = ops.session_user_id()
            AND ops.session_user_is_active()
          )
          OR (
            ops.staff_capability('support'::iam.role_code)
            AND (
              c.assigned_to = ops.session_user_id()
              OR c.assigned_to IS NULL
            )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM support.cases AS c
      WHERE c.id = case_events.case_id
        AND (
          (
            c.user_id = ops.session_user_id()
            AND ops.session_user_is_active()
          )
          OR ops.staff_capability('support'::iam.role_code)
        )
    )
  );

CREATE POLICY support_case_events_privacy_worker ON support.case_events
  FOR ALL TO dm_privacy_worker
  USING (true)
  WITH CHECK (true);

-- Ops actor-owned
CREATE POLICY idempotency_keys_owner ON ops.idempotency_keys
  FOR ALL TO dm_api
  USING (
    actor_user_id = ops.session_user_id()
    AND ops.session_user_is_active()
  )
  WITH CHECK (
    actor_user_id = ops.session_user_id()
    AND ops.session_user_is_active()
  );

CREATE POLICY audit_events_self_select ON ops.audit_events
  FOR SELECT TO dm_api
  USING (
    actor_user_id = ops.session_user_id()
    AND ops.session_user_is_active()
  );

CREATE POLICY audit_events_api_insert ON ops.audit_events
  FOR INSERT TO dm_api
  WITH CHECK (
    actor_user_id IS NULL
    OR actor_user_id = ops.session_user_id()
  );

CREATE POLICY audit_events_workers_insert ON ops.audit_events
  FOR INSERT TO dm_ai_worker, dm_billing_worker, dm_media_worker, dm_privacy_worker,
    dm_outbox_worker
  WITH CHECK (true);


-- ---------------------------------------------------------------------------
-- 5. Content policies: staff write; published readable by authenticated sessions
-- ---------------------------------------------------------------------------
CREATE POLICY curriculum_releases_staff ON content.curriculum_releases
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  );

CREATE POLICY curriculum_releases_published_select ON content.curriculum_releases
  FOR SELECT TO dm_api
  USING (status = 'published' AND ops.session_user_is_active());

CREATE POLICY curriculum_releases_ai_worker ON content.curriculum_releases
  FOR SELECT TO dm_ai_worker
  USING (status = 'published');

CREATE POLICY module_versions_staff ON content.module_versions
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY module_versions_published_select ON content.module_versions
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.release_modules AS rm
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE rm.module_version_id = module_versions.id
        AND r.status = 'published'
    )
  );

CREATE POLICY module_versions_ai_worker ON content.module_versions
  FOR SELECT TO dm_ai_worker
  USING (
    EXISTS (
      SELECT 1
      FROM content.release_modules AS rm
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE rm.module_version_id = module_versions.id
        AND r.status = 'published'
    )
  );

CREATE POLICY release_modules_staff ON content.release_modules
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY release_modules_published_select ON content.release_modules
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.curriculum_releases AS r
      WHERE r.id = release_modules.release_id
        AND r.status = 'published'
    )
  );

CREATE POLICY release_modules_ai_worker ON content.release_modules
  FOR SELECT TO dm_ai_worker
  USING (
    EXISTS (
      SELECT 1
      FROM content.curriculum_releases AS r
      WHERE r.id = release_modules.release_id
        AND r.status = 'published'
    )
  );

CREATE POLICY unit_versions_staff ON content.unit_versions
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY unit_versions_published_select ON content.unit_versions
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.module_units AS mu
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE mu.unit_version_id = unit_versions.id
        AND r.status = 'published'
    )
  );

CREATE POLICY unit_versions_ai_worker ON content.unit_versions
  FOR SELECT TO dm_ai_worker
  USING (
    EXISTS (
      SELECT 1
      FROM content.module_units AS mu
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE mu.unit_version_id = unit_versions.id
        AND r.status = 'published'
    )
  );

CREATE POLICY module_units_staff ON content.module_units
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY module_units_published_select ON content.module_units
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.release_modules AS rm
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE rm.module_version_id = module_units.module_version_id
        AND r.status = 'published'
    )
  );

CREATE POLICY module_units_ai_worker ON content.module_units
  FOR SELECT TO dm_ai_worker
  USING (
    EXISTS (
      SELECT 1
      FROM content.release_modules AS rm
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE rm.module_version_id = module_units.module_version_id
        AND r.status = 'published'
    )
  );

CREATE POLICY objective_versions_staff ON content.objective_versions
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY objective_versions_published_select ON content.objective_versions
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.unit_objectives AS uo
      JOIN content.module_units AS mu ON mu.unit_version_id = uo.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE uo.objective_version_id = objective_versions.id
        AND r.status = 'published'
    )
  );

CREATE POLICY objective_versions_ai_worker ON content.objective_versions
  FOR SELECT TO dm_ai_worker
  USING (
    EXISTS (
      SELECT 1
      FROM content.unit_objectives AS uo
      JOIN content.module_units AS mu ON mu.unit_version_id = uo.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE uo.objective_version_id = objective_versions.id
        AND r.status = 'published'
    )
  );

CREATE POLICY cefr_descriptor_versions_staff ON content.cefr_descriptor_versions
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY cefr_descriptor_versions_published_select ON content.cefr_descriptor_versions
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.objective_descriptors AS od
      JOIN content.unit_objectives AS uo ON uo.objective_version_id = od.objective_version_id
      JOIN content.module_units AS mu ON mu.unit_version_id = uo.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE od.descriptor_version_id = cefr_descriptor_versions.id
        AND r.status = 'published'
    )
  );

CREATE POLICY cefr_descriptor_versions_ai_worker ON content.cefr_descriptor_versions
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY unit_objectives_staff ON content.unit_objectives
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY unit_objectives_published_select ON content.unit_objectives
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.module_units AS mu
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE mu.unit_version_id = unit_objectives.unit_version_id
        AND r.status = 'published'
    )
  );

CREATE POLICY unit_objectives_ai_worker ON content.unit_objectives
  FOR SELECT TO dm_ai_worker
  USING (
    EXISTS (
      SELECT 1
      FROM content.module_units AS mu
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE mu.unit_version_id = unit_objectives.unit_version_id
        AND r.status = 'published'
    )
  );

CREATE POLICY objective_descriptors_staff ON content.objective_descriptors
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY objective_descriptors_published_select ON content.objective_descriptors
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.unit_objectives AS uo
      JOIN content.module_units AS mu ON mu.unit_version_id = uo.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE uo.objective_version_id = objective_descriptors.objective_version_id
        AND r.status = 'published'
    )
  );

CREATE POLICY objective_descriptors_ai_worker ON content.objective_descriptors
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY unit_prerequisites_staff ON content.unit_prerequisites
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY unit_prerequisites_published_select ON content.unit_prerequisites
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.module_units AS mu
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE mu.unit_version_id = unit_prerequisites.unit_version_id
        AND r.status = 'published'
    )
  );

CREATE POLICY unit_prerequisites_ai_worker ON content.unit_prerequisites
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY lesson_versions_staff ON content.lesson_versions
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY lesson_versions_published_select ON content.lesson_versions
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.unit_lessons AS ul
      JOIN content.module_units AS mu ON mu.unit_version_id = ul.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE ul.lesson_version_id = lesson_versions.id
        AND r.status = 'published'
    )
  );

CREATE POLICY lesson_versions_ai_worker ON content.lesson_versions
  FOR SELECT TO dm_ai_worker
  USING (
    EXISTS (
      SELECT 1
      FROM content.unit_lessons AS ul
      JOIN content.module_units AS mu ON mu.unit_version_id = ul.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE ul.lesson_version_id = lesson_versions.id
        AND r.status = 'published'
    )
  );

CREATE POLICY unit_lessons_staff ON content.unit_lessons
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY unit_lessons_published_select ON content.unit_lessons
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.module_units AS mu
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE mu.unit_version_id = unit_lessons.unit_version_id
        AND r.status = 'published'
    )
  );

CREATE POLICY unit_lessons_ai_worker ON content.unit_lessons
  FOR SELECT TO dm_ai_worker
  USING (
    EXISTS (
      SELECT 1
      FROM content.module_units AS mu
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE mu.unit_version_id = unit_lessons.unit_version_id
        AND r.status = 'published'
    )
  );

CREATE POLICY activity_versions_staff ON content.activity_versions
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY activity_versions_published_select ON content.activity_versions
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.lesson_activities AS la
      JOIN content.unit_lessons AS ul ON ul.lesson_version_id = la.lesson_version_id
      JOIN content.module_units AS mu ON mu.unit_version_id = ul.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE la.activity_version_id = activity_versions.id
        AND r.status = 'published'
    )
  );

CREATE POLICY activity_versions_ai_worker ON content.activity_versions
  FOR SELECT TO dm_ai_worker
  USING (
    EXISTS (
      SELECT 1
      FROM content.lesson_activities AS la
      JOIN content.unit_lessons AS ul ON ul.lesson_version_id = la.lesson_version_id
      JOIN content.module_units AS mu ON mu.unit_version_id = ul.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE la.activity_version_id = activity_versions.id
        AND r.status = 'published'
    )
  );

CREATE POLICY lesson_activities_staff ON content.lesson_activities
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY lesson_activities_published_select ON content.lesson_activities
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.unit_lessons AS ul
      JOIN content.module_units AS mu ON mu.unit_version_id = ul.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE ul.lesson_version_id = lesson_activities.lesson_version_id
        AND r.status = 'published'
    )
  );

CREATE POLICY lesson_activities_ai_worker ON content.lesson_activities
  FOR SELECT TO dm_ai_worker
  USING (
    EXISTS (
      SELECT 1
      FROM content.unit_lessons AS ul
      JOIN content.module_units AS mu ON mu.unit_version_id = ul.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE ul.lesson_version_id = lesson_activities.lesson_version_id
        AND r.status = 'published'
    )
  );

CREATE POLICY activity_objectives_staff ON content.activity_objectives
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY activity_objectives_published_select ON content.activity_objectives
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.lesson_activities AS la
      JOIN content.unit_lessons AS ul ON ul.lesson_version_id = la.lesson_version_id
      JOIN content.module_units AS mu ON mu.unit_version_id = ul.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE la.activity_version_id = activity_objectives.activity_version_id
        AND r.status = 'published'
    )
  );

CREATE POLICY activity_objectives_ai_worker ON content.activity_objectives
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY activity_assets_staff ON content.activity_assets
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY activity_assets_published_select ON content.activity_assets
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.lesson_activities AS la
      JOIN content.unit_lessons AS ul ON ul.lesson_version_id = la.lesson_version_id
      JOIN content.module_units AS mu ON mu.unit_version_id = ul.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE la.activity_version_id = activity_assets.activity_version_id
        AND r.status = 'published'
    )
  );

CREATE POLICY activity_assets_ai_worker ON content.activity_assets
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY answer_key_versions_staff ON content.answer_key_versions
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

-- Answer keys: authenticated learners may read keys for published activities
-- (scoring happens server-side; API still must not leak via wrong surfaces)
CREATE POLICY answer_key_versions_published_select ON content.answer_key_versions
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM content.lesson_activities AS la
      JOIN content.unit_lessons AS ul ON ul.lesson_version_id = la.lesson_version_id
      JOIN content.module_units AS mu ON mu.unit_version_id = ul.unit_version_id
      JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
      JOIN content.curriculum_releases AS r ON r.id = rm.release_id
      WHERE la.activity_version_id = answer_key_versions.activity_version_id
        AND r.status = 'published'
    )
  );

CREATE POLICY answer_key_versions_ai_worker ON content.answer_key_versions
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY rubric_versions_staff ON content.rubric_versions
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (ops.staff_capability('content_editor'::iam.role_code));

CREATE POLICY rubric_versions_published_select ON content.rubric_versions
  FOR SELECT TO dm_api
  USING (
    ops.session_user_is_active()
    AND (
      activity_version_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM content.lesson_activities AS la
        JOIN content.unit_lessons AS ul ON ul.lesson_version_id = la.lesson_version_id
        JOIN content.module_units AS mu ON mu.unit_version_id = ul.unit_version_id
        JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
        JOIN content.curriculum_releases AS r ON r.id = rm.release_id
        WHERE la.activity_version_id = rubric_versions.activity_version_id
          AND r.status = 'published'
      )
    )
  );

CREATE POLICY rubric_versions_ai_worker ON content.rubric_versions
  FOR SELECT TO dm_ai_worker
  USING (true);

CREATE POLICY review_events_staff ON content.review_events
  FOR ALL TO dm_api
  USING (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  )
  WITH CHECK (
    ops.staff_capability('content_editor'::iam.role_code)
    OR ops.staff_capability('content_reviewer'::iam.role_code)
  );

-- ---------------------------------------------------------------------------
-- 6. Published content views (security_barrier; invoker RLS still applies)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW content.v_published_curriculum_releases
WITH (security_barrier = true, security_invoker = true) AS
SELECT *
FROM content.curriculum_releases
WHERE status = 'published';

CREATE OR REPLACE VIEW content.v_published_unit_versions
WITH (security_barrier = true, security_invoker = true) AS
SELECT uv.*
FROM content.unit_versions AS uv
WHERE EXISTS (
  SELECT 1
  FROM content.module_units AS mu
  JOIN content.release_modules AS rm ON rm.module_version_id = mu.module_version_id
  JOIN content.curriculum_releases AS r ON r.id = rm.release_id
  WHERE mu.unit_version_id = uv.id
    AND r.status = 'published'
);

CREATE OR REPLACE VIEW learner.v_ai_profile_context
WITH (security_barrier = true, security_invoker = true) AS
SELECT
  user_id,
  version,
  goal,
  selected_level,
  target_level,
  study_minutes_per_day,
  study_days_per_week,
  preferences,
  effective_at
FROM learner.profile_versions;

-- Owner BYPASSRLS; not security_invoker (replica has no base-table grant)
CREATE OR REPLACE VIEW ops.v_read_replica_audit_redacted
WITH (security_barrier = true) AS
SELECT
  id,
  occurred_at,
  actor_type,
  action,
  resource_type,
  outcome,
  reason_code,
  correlation_id,
  created_at
FROM ops.audit_events;

-- ---------------------------------------------------------------------------
-- 7. Least-privilege table grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  sch text;
BEGIN
  FOREACH sch IN ARRAY ARRAY[
    'iam', 'learner', 'media', 'content', 'learning', 'ai', 'billing',
    'privacy', 'support', 'ops'
  ] LOOP
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC', sch);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC', sch);
  END LOOP;
END
$$;

-- dm_api: product surface
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA iam TO dm_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA learner TO dm_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA media TO dm_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA content TO dm_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA learning TO dm_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ai TO dm_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA billing TO dm_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA privacy TO dm_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA support TO dm_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ops.idempotency_keys TO dm_api;
GRANT SELECT, INSERT, UPDATE ON ops.outbox_events TO dm_api;
GRANT SELECT, INSERT ON ops.audit_events TO dm_api;
GRANT SELECT ON ops.inbox_events TO dm_api;
GRANT SELECT ON content.v_published_curriculum_releases TO dm_api;
GRANT SELECT ON content.v_published_unit_versions TO dm_api;

-- dm_ai_worker: minimum profile/content + ai/learning write surface; NO billing
GRANT SELECT ON learner.profile_versions TO dm_ai_worker;
GRANT SELECT ON learner.proficiency_snapshots TO dm_ai_worker;
GRANT SELECT ON learner.v_ai_profile_context TO dm_ai_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA content TO dm_ai_worker;
GRANT SELECT ON content.v_published_curriculum_releases TO dm_ai_worker;
GRANT SELECT ON content.v_published_unit_versions TO dm_ai_worker;
GRANT SELECT ON learning.sessions TO dm_ai_worker;
GRANT SELECT ON learning.activity_attempts TO dm_ai_worker;
GRANT SELECT ON learning.attempt_responses TO dm_ai_worker;
GRANT SELECT, INSERT, UPDATE ON learning.attempt_scores TO dm_ai_worker;
GRANT SELECT, INSERT, UPDATE ON learning.feedback_records TO dm_ai_worker;
GRANT SELECT ON learning.evidence TO dm_ai_worker;
GRANT SELECT ON learning.review_items TO dm_ai_worker;
GRANT SELECT ON learning.recommendation_runs TO dm_ai_worker;
GRANT SELECT ON learning.unit_progress TO dm_ai_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ai TO dm_ai_worker;
GRANT SELECT, INSERT, UPDATE ON ops.inbox_events TO dm_ai_worker;
GRANT SELECT, INSERT, UPDATE ON ops.outbox_events TO dm_ai_worker;
GRANT INSERT ON ops.audit_events TO dm_ai_worker;

-- Explicitly no billing schema usage beyond CONNECT/USAGE already absent for tables
-- (USAGE on billing was never granted to dm_ai_worker in 0001)

-- dm_billing_worker: billing + ops; NO learning/content
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA billing TO dm_billing_worker;
GRANT SELECT, INSERT, UPDATE ON ops.inbox_events TO dm_billing_worker;
GRANT SELECT, INSERT, UPDATE ON ops.outbox_events TO dm_billing_worker;
GRANT SELECT, INSERT, UPDATE ON ops.idempotency_keys TO dm_billing_worker;
GRANT INSERT ON ops.audit_events TO dm_billing_worker;

-- dm_media_worker
GRANT SELECT, INSERT, UPDATE ON media.objects TO dm_media_worker;
GRANT SELECT, INSERT, UPDATE ON ops.inbox_events TO dm_media_worker;
GRANT SELECT, INSERT, UPDATE ON ops.outbox_events TO dm_media_worker;
GRANT INSERT ON ops.audit_events TO dm_media_worker;

-- dm_privacy_worker
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA privacy TO dm_privacy_worker;
GRANT SELECT, UPDATE ON iam.users TO dm_privacy_worker;
GRANT SELECT ON iam.user_identities TO dm_privacy_worker;
GRANT SELECT ON iam.user_roles TO dm_privacy_worker;
GRANT SELECT, INSERT ON iam.consent_events TO dm_privacy_worker;
GRANT SELECT, UPDATE, DELETE ON ALL TABLES IN SCHEMA learner TO dm_privacy_worker;
GRANT SELECT, UPDATE, DELETE ON ALL TABLES IN SCHEMA learning TO dm_privacy_worker;
GRANT SELECT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ai TO dm_privacy_worker;
GRANT SELECT, UPDATE, DELETE ON ALL TABLES IN SCHEMA billing TO dm_privacy_worker;
GRANT SELECT, UPDATE, DELETE ON ALL TABLES IN SCHEMA support TO dm_privacy_worker;
GRANT SELECT, UPDATE ON media.objects TO dm_privacy_worker;
GRANT SELECT, INSERT, UPDATE ON ops.inbox_events TO dm_privacy_worker;
GRANT SELECT, INSERT, UPDATE ON ops.outbox_events TO dm_privacy_worker;
GRANT INSERT ON ops.audit_events TO dm_privacy_worker;

-- dm_outbox_worker
GRANT SELECT, UPDATE ON ops.outbox_events TO dm_outbox_worker;
GRANT SELECT, INSERT, UPDATE ON ops.inbox_events TO dm_outbox_worker;
GRANT INSERT ON ops.audit_events TO dm_outbox_worker;

-- dm_read_replica: redacted reporting views only
GRANT SELECT ON ops.v_read_replica_audit_redacted TO dm_read_replica;

-- Ensure workers without learning USAGE cannot acquire learning grants accidentally:
-- billing worker has no USAGE on learning/content (set in 0001).

COMMENT ON VIEW content.v_published_curriculum_releases IS
  'Published curriculum releases only (Database.md §8).';
COMMENT ON VIEW content.v_published_unit_versions IS
  'Unit versions referenced by a published curriculum release.';
COMMENT ON VIEW learner.v_ai_profile_context IS
  'Minimum profile columns for AI workers (no billing payloads).';
COMMENT ON VIEW ops.v_read_replica_audit_redacted IS
  'Redacted audit projection for dm_read_replica.';

-- Schema USAGE expansions required by least-privilege table grants above
RESET ROLE;
GRANT USAGE ON SCHEMA learner TO dm_privacy_worker;
GRANT USAGE ON SCHEMA learning TO dm_privacy_worker;
GRANT USAGE ON SCHEMA ai TO dm_privacy_worker;
GRANT USAGE ON SCHEMA billing TO dm_privacy_worker;
GRANT USAGE ON SCHEMA support TO dm_privacy_worker;
GRANT USAGE ON SCHEMA media TO dm_privacy_worker;
GRANT USAGE ON SCHEMA content TO dm_ai_worker;
GRANT USAGE ON SCHEMA learner TO dm_ai_worker;
GRANT USAGE ON SCHEMA learning TO dm_ai_worker;

-- Redacted replica view must run as BYPASSRLS owner (FORCE RLS on audit_events)
ALTER VIEW ops.v_read_replica_audit_redacted OWNER TO dm_security;
GRANT SELECT ON ops.audit_events TO dm_security;
GRANT USAGE ON SCHEMA ops TO dm_security;
SET LOCAL ROLE dm_migrator;
