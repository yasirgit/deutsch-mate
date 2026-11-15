/**
 * Asserts MVP schema contract: expected tables/enums exist; forbidden post-MVP
 * tables are absent (DM-021; docs/Database.md).
 */

import pg from "pg";

import { loadLocalEnv } from "./lib/env.ts";
import { waitForPostgres } from "./wait-for-services.ts";

const EXPECTED_TABLES: readonly string[] = [
  "iam.users",
  "iam.user_identities",
  "iam.user_roles",
  "iam.legal_document_versions",
  "iam.consent_events",
  "learner.profile_versions",
  "learner.onboarding_states",
  "learner.proficiency_snapshots",
  "media.objects",
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
  "learning.sessions",
  "learning.activity_attempts",
  "learning.attempt_responses",
  "learning.attempt_scores",
  "learning.feedback_records",
  "learning.evidence",
  "learning.review_items",
  "learning.recommendation_runs",
  "learning.unit_progress",
  "ai.prompt_versions",
  "ai.model_config_versions",
  "ai.releases",
  "ai.threads",
  "ai.runs",
  "ai.messages",
  "ai.trace_events",
  "ai.langgraph_checkpoints",
  "ai.langgraph_writes",
  "billing.plans",
  "billing.plan_prices",
  "billing.plan_features",
  "billing.customers",
  "billing.checkout_sessions",
  "billing.subscriptions",
  "billing.entitlements",
  "billing.entitlement_events",
  "billing.usage_events",
  "billing.webhook_events",
  "billing.reconciliation_runs",
  "billing.reconciliation_items",
  "privacy.requests",
  "privacy.request_events",
  "privacy.erasure_tasks",
  "support.cases",
  "support.case_events",
  "ops.idempotency_keys",
  "ops.outbox_events",
  "ops.inbox_events",
  "ops.audit_events",
  "ops.schema_migrations",
];

const EXPECTED_ENUMS: readonly string[] = [
  "iam.account_status",
  "iam.role_code",
  "iam.consent_decision",
  "learner.cefr_level",
  "learner.goal_code",
  "content.release_status",
  "content.skill_code",
  "content.activity_type",
  "content.transcript_policy",
  "learning.session_status",
  "learning.attempt_status",
  "learning.evidence_validity",
  "learning.recommendation_kind",
  "ai.feature_code",
  "ai.run_status",
  "ai.disposition",
  "ai.message_role",
  "billing.provider_code",
  "billing.subscription_status",
  "billing.entitlement_status",
  "media.object_state",
  "media.data_class",
  "privacy.request_type",
  "privacy.request_status",
  "support.case_category",
  "support.case_status",
  "ops.delivery_status",
];

/** Post-MVP / out-of-scope names that must not appear as tables. */
const FORBIDDEN_TABLE_NAME_PATTERNS: readonly RegExp[] = [
  /assessment/i,
  /placement/i,
  /exam/i,
  /speaking/i,
  /speech/i,
  /reminder/i,
  /conversation_histor/i,
  /iap/i,
  /in_app_purchase/i,
  /storekit/i,
  /play_billing/i,
];

const CAPABILITY_SCHEMAS = [
  "iam",
  "learner",
  "media",
  "content",
  "learning",
  "ai",
  "billing",
  "privacy",
  "support",
  "ops",
] as const;

async function main(): Promise<void> {
  const env = loadLocalEnv();
  await waitForPostgres(env, 15_000);
  const client = new pg.Client(env.postgres);
  await client.connect();
  const errors: string[] = [];

  try {
    const { rows: tables } = await client.query<{
      qualified: string;
      table_name: string;
    }>(
      `SELECT table_schema || '.' || table_name AS qualified, table_name
       FROM information_schema.tables
       WHERE table_type = 'BASE TABLE'
         AND table_schema = ANY($1::text[])
       ORDER BY 1`,
      [CAPABILITY_SCHEMAS],
    );

    const present = new Set(tables.map((row) => row.qualified));
    for (const expected of EXPECTED_TABLES) {
      if (!present.has(expected)) {
        errors.push(`Missing expected table ${expected}`);
      }
    }
    for (const row of tables) {
      if (!EXPECTED_TABLES.includes(row.qualified)) {
        errors.push(`Unexpected table ${row.qualified}`);
      }
      for (const pattern of FORBIDDEN_TABLE_NAME_PATTERNS) {
        if (pattern.test(row.table_name) || pattern.test(row.qualified)) {
          errors.push(`Forbidden post-MVP table ${row.qualified}`);
        }
      }
    }

    const { rows: enums } = await client.query<{ qualified: string }>(
      `SELECT n.nspname || '.' || t.typname AS qualified
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typtype = 'e'
         AND n.nspname = ANY($1::text[])
       ORDER BY 1`,
      [CAPABILITY_SCHEMAS],
    );
    const enumPresent = new Set(enums.map((row) => row.qualified));
    for (const expected of EXPECTED_ENUMS) {
      if (!enumPresent.has(expected)) {
        errors.push(`Missing expected enum ${expected}`);
      }
    }
    for (const row of enums) {
      if (!EXPECTED_ENUMS.includes(row.qualified)) {
        errors.push(`Unexpected enum ${row.qualified}`);
      }
    }

    // Spot-check money/numeric conventions on known columns.
    const { rows: moneyCols } = await client.query<{
      attname: string;
      typname: string;
    }>(
      `SELECT a.attname, t.typname
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
       WHERE n.nspname = 'billing'
         AND c.relname = 'plan_prices'
         AND a.attname IN ('amount_minor', 'currency')
         AND a.attnum > 0
         AND NOT a.attisdropped`,
    );
    const byName = new Map(moneyCols.map((row) => [row.attname, row.typname]));
    if (byName.get("amount_minor") !== "int8") {
      errors.push(
        `billing.plan_prices.amount_minor must be bigint, got ${byName.get("amount_minor") ?? "missing"}`,
      );
    }
    if (byName.get("currency") !== "bpchar") {
      errors.push(
        `billing.plan_prices.currency must be char(3), got ${byName.get("currency") ?? "missing"}`,
      );
    }

    const { rows: uuidDefaults } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM information_schema.columns
       WHERE table_schema = ANY($1::text[])
         AND column_name = 'id'
         AND column_default IS NOT NULL`,
      [CAPABILITY_SCHEMAS],
    );
    if (uuidDefaults[0]?.count !== "0") {
      errors.push(
        `Found ${uuidDefaults[0]?.count ?? "?"} uuid id columns with database defaults; UUIDv7 must be application-generated`,
      );
    }

    if (errors.length > 0) {
      console.error("[db:contract] FAILED:");
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    console.log(
      `[db:contract] OK — ${String(EXPECTED_TABLES.length)} tables, ${String(EXPECTED_ENUMS.length)} enums; no forbidden post-MVP tables.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("[db:contract] Error:", error);
  process.exit(1);
});
