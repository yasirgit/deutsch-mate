/**
 * Asserts primary keys, foreign keys, unique constraints, check constraints,
 * and key exclusion constraints from docs/Database.md (DM-021).
 */

import pg from "pg";

import { loadLocalEnv } from "./lib/env.ts";
import { waitForPostgres } from "./wait-for-services.ts";

interface NamedConstraint {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
}

const REQUIRED_PKS: readonly string[] = [
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
];

const REQUIRED_UNIQUE_INDEXES: readonly string[] = [
  "users_primary_email_uidx",
  "user_roles_active_uidx",
  "idempotency_keys_scope_actor_key_uidx",
  "plan_prices_provider_price_id_uidx",
  "checkout_sessions_provider_checkout_id_uidx",
  "ai_one_published_release_per_feature",
];

const REQUIRED_EXCLUSION_CONSTRAINTS: readonly string[] = [
  "plan_prices_no_overlap",
  "plan_features_no_overlap",
  "entitlements_active_no_overlap",
];

const REQUIRED_FK_SAMPLES: readonly {
  readonly from: string;
  readonly to: string;
}[] = [
  { from: "media.objects", to: "iam.users" },
  { from: "iam.legal_document_versions", to: "media.objects" },
  { from: "learner.onboarding_states", to: "content.unit_versions" },
  { from: "learning.feedback_records", to: "ai.runs" },
  { from: "ai.runs", to: "learning.activity_attempts" },
  { from: "billing.checkout_sessions", to: "ops.idempotency_keys" },
  { from: "billing.entitlement_events", to: "billing.webhook_events" },
  { from: "ai.langgraph_writes", to: "ai.langgraph_checkpoints" },
];

const REQUIRED_CHECK_TABLES: readonly string[] = [
  "iam.users",
  "learning.attempt_responses",
  "learning.recommendation_runs",
  "content.activity_versions",
  "billing.plan_prices",
];

async function main(): Promise<void> {
  const env = loadLocalEnv();
  await waitForPostgres(env, 15_000);
  const client = new pg.Client(env.postgres);
  await client.connect();
  const errors: string[] = [];

  try {
    const { rows: pks } = await client.query<{ qualified: string }>(
      `SELECT n.nspname || '.' || c.relname AS qualified
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE con.contype = 'p'
         AND n.nspname = ANY($1::text[])`,
      [
        [
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
        ],
      ],
    );
    const pkSet = new Set(pks.map((row) => row.qualified));
    for (const table of REQUIRED_PKS) {
      if (!pkSet.has(table)) {
        errors.push(`Missing primary key on ${table}`);
      }
    }

    const { rows: fks } = await client.query<{
      from_table: string;
      to_table: string;
      deferrable: boolean;
    }>(
      `SELECT
         nf.nspname || '.' || cf.relname AS from_table,
         nt.nspname || '.' || ct.relname AS to_table,
         con.condeferrable AS deferrable
       FROM pg_constraint con
       JOIN pg_class cf ON cf.oid = con.conrelid
       JOIN pg_namespace nf ON nf.oid = cf.relnamespace
       JOIN pg_class ct ON ct.oid = con.confrelid
       JOIN pg_namespace nt ON nt.oid = ct.relnamespace
       WHERE con.contype = 'f'`,
    );
    for (const sample of REQUIRED_FK_SAMPLES) {
      const match = fks.find((row) => row.from_table === sample.from && row.to_table === sample.to);
      if (!match) {
        errors.push(`Missing FK ${sample.from} → ${sample.to}`);
      }
    }
    const entitlementWebhook = fks.find(
      (row) =>
        row.from_table === "billing.entitlement_events" &&
        row.to_table === "billing.webhook_events",
    );
    if (entitlementWebhook && !entitlementWebhook.deferrable) {
      errors.push("billing.entitlement_events.webhook_event_id FK must be DEFERRABLE");
    }

    const { rows: uniques } = await client.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = ANY($1::text[])`,
      [
        [
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
        ],
      ],
    );
    const indexNames = new Set(uniques.map((row) => row.indexname));
    for (const name of REQUIRED_UNIQUE_INDEXES) {
      if (!indexNames.has(name)) {
        errors.push(`Missing unique/partial index ${name}`);
      }
    }

    const { rows: exclusions } = await client.query<NamedConstraint>(
      `SELECT n.nspname AS schema, c.relname AS table, con.conname AS name
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE con.contype = 'x'`,
    );
    const exclusionNames = new Set(exclusions.map((row) => row.name));
    for (const name of REQUIRED_EXCLUSION_CONSTRAINTS) {
      if (!exclusionNames.has(name)) {
        errors.push(`Missing exclusion constraint ${name}`);
      }
    }

    const { rows: checks } = await client.query<{ qualified: string; count: string }>(
      `SELECT n.nspname || '.' || c.relname AS qualified, count(*)::text AS count
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE con.contype = 'c'
       GROUP BY 1`,
    );
    const checkCounts = new Map(checks.map((row) => [row.qualified, Number(row.count)]));
    for (const table of REQUIRED_CHECK_TABLES) {
      if ((checkCounts.get(table) ?? 0) < 1) {
        errors.push(`Expected CHECK constraints on ${table}`);
      }
    }

    const { rows: fkCount } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_constraint
       WHERE contype = 'f'`,
    );
    if (Number(fkCount[0]?.count ?? 0) < 80) {
      errors.push(`Expected many foreign keys; found ${fkCount[0]?.count ?? "0"}`);
    }

    if (errors.length > 0) {
      console.error("[db:constraints] FAILED:");
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    console.log(
      `[db:constraints] OK — ${String(REQUIRED_PKS.length)} PKs, ${fkCount[0]?.count ?? "?"} FKs, exclusion/unique/check samples verified.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("[db:constraints] Error:", error);
  process.exit(1);
});
