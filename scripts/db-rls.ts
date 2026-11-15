/**
 * Asserts RLS is ENABLE+FORCE on all user-owned / child-owned tables and that
 * sample ownership policies exist (DM-022; docs/Database.md §8).
 */

import pg from "pg";

import { loadLocalEnv } from "./lib/env.ts";
import { waitForPostgres } from "./wait-for-services.ts";

/** Tables that must have ENABLE + FORCE ROW LEVEL SECURITY. */
const RLS_REQUIRED_TABLES: readonly string[] = [
  "iam.users",
  "iam.user_identities",
  "iam.user_roles",
  "iam.consent_events",
  "iam.legal_document_versions",
  "learner.profile_versions",
  "learner.onboarding_states",
  "learner.proficiency_snapshots",
  "media.objects",
  "learning.sessions",
  "learning.activity_attempts",
  "learning.attempt_responses",
  "learning.attempt_scores",
  "learning.feedback_records",
  "learning.evidence",
  "learning.review_items",
  "learning.recommendation_runs",
  "learning.unit_progress",
  "ai.threads",
  "ai.runs",
  "ai.messages",
  "ai.trace_events",
  "ai.langgraph_checkpoints",
  "ai.langgraph_writes",
  "ai.prompt_versions",
  "ai.model_config_versions",
  "ai.releases",
  "billing.customers",
  "billing.checkout_sessions",
  "billing.subscriptions",
  "billing.entitlements",
  "billing.entitlement_events",
  "billing.usage_events",
  "privacy.requests",
  "privacy.request_events",
  "privacy.erasure_tasks",
  "support.cases",
  "support.case_events",
  "ops.idempotency_keys",
  "ops.audit_events",
  "content.curriculum_releases",
  "content.module_versions",
  "content.release_modules",
  "content.unit_versions",
  "content.module_units",
  "content.objective_versions",
  "content.cefr_descriptor_versions",
  "content.unit_objectives",
  "content.objective_descriptors",
  "content.unit_prerequisites",
  "content.lesson_versions",
  "content.unit_lessons",
  "content.activity_versions",
  "content.lesson_activities",
  "content.activity_objectives",
  "content.activity_assets",
  "content.answer_key_versions",
  "content.rubric_versions",
  "content.review_events",
];

/** Sample policies that must exist (name → qualified table). */
const SAMPLE_POLICIES: readonly { table: string; policy: string }[] = [
  { table: "iam.users", policy: "users_self_select" },
  { table: "learner.profile_versions", policy: "profile_versions_owner" },
  { table: "learning.attempt_responses", policy: "attempt_responses_via_parent" },
  { table: "ai.messages", policy: "messages_via_parent" },
  { table: "billing.subscriptions", policy: "subscriptions_via_parent" },
  { table: "privacy.erasure_tasks", policy: "privacy_erasure_tasks_via_parent" },
  { table: "support.case_events", policy: "support_case_events_via_parent" },
  { table: "content.curriculum_releases", policy: "curriculum_releases_published_select" },
  { table: "media.objects", policy: "media_objects_owner" },
];

const RUNTIME_ROLES = [
  "dm_api",
  "dm_ai_worker",
  "dm_billing_worker",
  "dm_media_worker",
  "dm_privacy_worker",
  "dm_outbox_worker",
  "dm_read_replica",
] as const;

async function main(): Promise<void> {
  const env = loadLocalEnv();
  await waitForPostgres(env, 15_000);
  const client = new pg.Client(env.postgres);
  await client.connect();
  const errors: string[] = [];

  try {
    const { rows: rlsRows } = await client.query<{
      qualified: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT n.nspname || '.' || c.relname AS qualified,
              c.relrowsecurity,
              c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r'
         AND n.nspname || '.' || c.relname = ANY($1::text[])`,
      [RLS_REQUIRED_TABLES],
    );

    const byName = new Map(rlsRows.map((row) => [row.qualified, row]));
    for (const table of RLS_REQUIRED_TABLES) {
      const row = byName.get(table);
      if (row === undefined) {
        errors.push(`Missing table ${table}`);
        continue;
      }
      if (!row.relrowsecurity) {
        errors.push(`RLS not enabled on ${table}`);
      }
      if (!row.relforcerowsecurity) {
        errors.push(`FORCE RLS not set on ${table}`);
      }
    }

    for (const sample of SAMPLE_POLICIES) {
      const { rows } = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM pg_policies
           WHERE schemaname || '.' || tablename = $1
             AND policyname = $2
         ) AS exists`,
        [sample.table, sample.policy],
      );
      if (rows[0]?.exists !== true) {
        errors.push(`Missing policy ${sample.policy} on ${sample.table}`);
      }
    }

    const { rows: helperFns } = await client.query<{ name: string }>(
      `SELECT p.proname AS name
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'ops'
         AND p.proname IN (
           'session_user_id',
           'session_user_is_active',
           'has_active_role',
           'staff_capability',
           'app_claims_role'
         )`,
    );
    const helpers = new Set(helperFns.map((row) => row.name));
    for (const name of [
      "session_user_id",
      "session_user_is_active",
      "has_active_role",
      "staff_capability",
      "app_claims_role",
    ]) {
      if (!helpers.has(name)) {
        errors.push(`Missing helper function ops.${name}`);
      }
    }

    const { rows: secOwner } = await client.query<{ rolname: string; rolbypassrls: boolean }>(
      `SELECT r.rolname, r.rolbypassrls
       FROM pg_roles r
       WHERE r.rolname = 'dm_security'`,
    );
    if (secOwner[0] === undefined) {
      errors.push("Missing role dm_security");
    } else if (!secOwner[0].rolbypassrls) {
      errors.push("dm_security must have BYPASSRLS for security-definer helpers");
    }

    for (const role of RUNTIME_ROLES) {
      const { rows } = await client.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
        `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1`,
        [role],
      );
      if (rows[0] === undefined) {
        errors.push(`Missing runtime role ${role}`);
        continue;
      }
      if (rows[0].rolbypassrls) {
        errors.push(`Runtime role ${role} must not have BYPASSRLS`);
      }
      if (rows[0].rolsuper) {
        errors.push(`Runtime role ${role} must not be superuser`);
      }
    }

    // Billing worker must not have table privileges on learning schema.
    const { rows: billingLearning } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM information_schema.role_table_grants
       WHERE grantee = 'dm_billing_worker'
         AND table_schema = 'learning'`,
    );
    if (billingLearning[0]?.count !== "0") {
      errors.push(
        `dm_billing_worker must not have learning table grants (found ${billingLearning[0]?.count ?? "?"})`,
      );
    }

    // AI worker must not have billing table privileges.
    const { rows: aiBilling } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM information_schema.role_table_grants
       WHERE grantee = 'dm_ai_worker'
         AND table_schema = 'billing'`,
    );
    if (aiBilling[0]?.count !== "0") {
      errors.push(
        `dm_ai_worker must not have billing table grants (found ${aiBilling[0]?.count ?? "?"})`,
      );
    }

    const { rows: views } = await client.query<{ qualified: string }>(
      `SELECT n.nspname || '.' || c.relname AS qualified
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'v'
         AND n.nspname || '.' || c.relname = ANY($1::text[])`,
      [
        [
          "content.v_published_curriculum_releases",
          "content.v_published_unit_versions",
          "content.v_published_module_versions",
          "content.v_published_lesson_versions",
          "content.v_published_activity_versions",
          "learner.v_ai_profile_context",
          "ops.v_read_replica_audit_redacted",
        ],
      ],
    );
    if (views.length !== 7) {
      errors.push(`Expected 7 published/redacted views, found ${String(views.length)}`);
    }

    if (errors.length > 0) {
      console.error("[db:rls] FAILED:");
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    console.log(
      `[db:rls] OK — FORCE RLS on ${String(RLS_REQUIRED_TABLES.length)} tables; sample policies present; runtime roles cannot BYPASSRLS; worker grant boundaries hold.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("[db:rls] Error:", error);
  process.exit(1);
});
