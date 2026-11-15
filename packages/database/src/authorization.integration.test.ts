/**
 * Cross-user RLS authorization tests (DM-022; docs/Database.md §8).
 * Positive (owner) and negative (other user) cases for every user-owned
 * resource type, plus staff/admin-is-not-bypass and worker grant boundaries.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyMigrations,
  setTransactionAppContext,
  type TransactionAppContext,
} from "./index.js";

const repoMigrations = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../migrations",
);

function uuidV7(): string {
  const bytes = Buffer.from(randomUUID().replace(/-/g, ""), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sha256Hex(seed: string): string {
  return seed
    .padEnd(64, "0")
    .slice(0, 64)
    .replace(/[^0-9a-f]/g, "a");
}

interface SeedIds {
  userA: string;
  userB: string;
  adminUser: string;
  mediaA: string;
  mediaB: string;
  profileA: string;
  profileB: string;
  sessionA: string;
  sessionB: string;
  attemptA: string;
  attemptB: string;
  responseA: string;
  responseB: string;
  scoreA: string;
  scoreB: string;
  feedbackA: string;
  feedbackB: string;
  evidenceA: string;
  evidenceB: string;
  reviewA: string;
  reviewB: string;
  recoA: string;
  recoB: string;
  threadA: string;
  threadB: string;
  runA: string;
  runB: string;
  messageA: string;
  messageB: string;
  traceA: string;
  traceB: string;
  customerA: string;
  customerB: string;
  checkoutA: string;
  checkoutB: string;
  subA: string;
  subB: string;
  entitlementA: string;
  entitlementB: string;
  entitlementEventA: string;
  entitlementEventB: string;
  usageA: string;
  usageB: string;
  privacyA: string;
  privacyB: string;
  privacyEventA: string;
  privacyEventB: string;
  erasureA: string;
  erasureB: string;
  caseA: string;
  caseB: string;
  caseEventA: string;
  caseEventB: string;
  identityA: string;
  identityB: string;
  roleA: string;
  roleB: string;
  consentA: string;
  consentB: string;
  idemA: string;
  idemB: string;
  auditA: string;
  auditB: string;
  releaseId: string;
  unitId: string;
  moduleId: string;
  objectiveId: string;
  lessonId: string;
  activityId: string;
  planId: string;
  planPriceId: string;
  aiReleaseId: string;
  promptId: string;
  modelConfigId: string;
  checkpointNs: string;
  checkpointId: string;
}

/** Every user-owned resource type under RLS (direct + child-via-parent). */
const USER_OWNED_RESOURCES: readonly {
  readonly name: string;
  readonly countSql: string;
  readonly idParam: keyof SeedIds;
}[] = [
  { name: "iam.users", countSql: `SELECT count(*)::int AS n FROM iam.users WHERE id = $1`, idParam: "userA" },
  {
    name: "iam.user_identities",
    countSql: `SELECT count(*)::int AS n FROM iam.user_identities WHERE id = $1`,
    idParam: "identityA",
  },
  {
    name: "iam.user_roles",
    countSql: `SELECT count(*)::int AS n FROM iam.user_roles WHERE id = $1`,
    idParam: "roleA",
  },
  {
    name: "iam.consent_events",
    countSql: `SELECT count(*)::int AS n FROM iam.consent_events WHERE id = $1`,
    idParam: "consentA",
  },
  {
    name: "learner.profile_versions",
    countSql: `SELECT count(*)::int AS n FROM learner.profile_versions WHERE id = $1`,
    idParam: "profileA",
  },
  {
    name: "learner.onboarding_states",
    countSql: `SELECT count(*)::int AS n FROM learner.onboarding_states WHERE user_id = $1`,
    idParam: "userA",
  },
  {
    name: "learner.proficiency_snapshots",
    countSql: `SELECT count(*)::int AS n FROM learner.proficiency_snapshots WHERE user_id = $1`,
    idParam: "userA",
  },
  {
    name: "media.objects",
    countSql: `SELECT count(*)::int AS n FROM media.objects WHERE id = $1`,
    idParam: "mediaA",
  },
  {
    name: "learning.sessions",
    countSql: `SELECT count(*)::int AS n FROM learning.sessions WHERE id = $1`,
    idParam: "sessionA",
  },
  {
    name: "learning.activity_attempts",
    countSql: `SELECT count(*)::int AS n FROM learning.activity_attempts WHERE id = $1`,
    idParam: "attemptA",
  },
  {
    name: "learning.attempt_responses",
    countSql: `SELECT count(*)::int AS n FROM learning.attempt_responses WHERE id = $1`,
    idParam: "responseA",
  },
  {
    name: "learning.attempt_scores",
    countSql: `SELECT count(*)::int AS n FROM learning.attempt_scores WHERE id = $1`,
    idParam: "scoreA",
  },
  {
    name: "learning.feedback_records",
    countSql: `SELECT count(*)::int AS n FROM learning.feedback_records WHERE id = $1`,
    idParam: "feedbackA",
  },
  {
    name: "learning.evidence",
    countSql: `SELECT count(*)::int AS n FROM learning.evidence WHERE id = $1`,
    idParam: "evidenceA",
  },
  {
    name: "learning.review_items",
    countSql: `SELECT count(*)::int AS n FROM learning.review_items WHERE id = $1`,
    idParam: "reviewA",
  },
  {
    name: "learning.recommendation_runs",
    countSql: `SELECT count(*)::int AS n FROM learning.recommendation_runs WHERE id = $1`,
    idParam: "recoA",
  },
  {
    name: "learning.unit_progress",
    countSql: `SELECT count(*)::int AS n FROM learning.unit_progress WHERE user_id = $1`,
    idParam: "userA",
  },
  {
    name: "ai.threads",
    countSql: `SELECT count(*)::int AS n FROM ai.threads WHERE id = $1`,
    idParam: "threadA",
  },
  { name: "ai.runs", countSql: `SELECT count(*)::int AS n FROM ai.runs WHERE id = $1`, idParam: "runA" },
  {
    name: "ai.messages",
    countSql: `SELECT count(*)::int AS n FROM ai.messages WHERE id = $1`,
    idParam: "messageA",
  },
  {
    name: "ai.trace_events",
    countSql: `SELECT count(*)::int AS n FROM ai.trace_events WHERE id = $1`,
    idParam: "traceA",
  },
  {
    name: "ai.langgraph_checkpoints",
    countSql: `SELECT count(*)::int AS n FROM ai.langgraph_checkpoints WHERE thread_id = $1`,
    idParam: "threadA",
  },
  {
    name: "ai.langgraph_writes",
    countSql: `SELECT count(*)::int AS n FROM ai.langgraph_writes WHERE thread_id = $1`,
    idParam: "threadA",
  },
  {
    name: "billing.customers",
    countSql: `SELECT count(*)::int AS n FROM billing.customers WHERE id = $1`,
    idParam: "customerA",
  },
  {
    name: "billing.checkout_sessions",
    countSql: `SELECT count(*)::int AS n FROM billing.checkout_sessions WHERE id = $1`,
    idParam: "checkoutA",
  },
  {
    name: "billing.subscriptions",
    countSql: `SELECT count(*)::int AS n FROM billing.subscriptions WHERE id = $1`,
    idParam: "subA",
  },
  {
    name: "billing.entitlements",
    countSql: `SELECT count(*)::int AS n FROM billing.entitlements WHERE id = $1`,
    idParam: "entitlementA",
  },
  {
    name: "billing.entitlement_events",
    countSql: `SELECT count(*)::int AS n FROM billing.entitlement_events WHERE id = $1`,
    idParam: "entitlementEventA",
  },
  {
    name: "billing.usage_events",
    countSql: `SELECT count(*)::int AS n FROM billing.usage_events WHERE id = $1`,
    idParam: "usageA",
  },
  {
    name: "privacy.requests",
    countSql: `SELECT count(*)::int AS n FROM privacy.requests WHERE id = $1`,
    idParam: "privacyA",
  },
  {
    name: "privacy.request_events",
    countSql: `SELECT count(*)::int AS n FROM privacy.request_events WHERE id = $1`,
    idParam: "privacyEventA",
  },
  {
    name: "privacy.erasure_tasks",
    countSql: `SELECT count(*)::int AS n FROM privacy.erasure_tasks WHERE id = $1`,
    idParam: "erasureA",
  },
  {
    name: "support.cases",
    countSql: `SELECT count(*)::int AS n FROM support.cases WHERE id = $1`,
    idParam: "caseA",
  },
  {
    name: "support.case_events",
    countSql: `SELECT count(*)::int AS n FROM support.case_events WHERE id = $1`,
    idParam: "caseEventA",
  },
  {
    name: "ops.idempotency_keys",
    countSql: `SELECT count(*)::int AS n FROM ops.idempotency_keys WHERE id = $1`,
    idParam: "idemA",
  },
  {
    name: "ops.audit_events",
    countSql: `SELECT count(*)::int AS n FROM ops.audit_events WHERE id = $1`,
    idParam: "auditA",
  },
];

describe("RLS authorization (DM-022)", () => {
  const adminUrl =
    process.env["DATABASE_URL"] ??
    "postgresql://deutsch_mate:local-dev-only-not-a-secret@localhost:54329/deutsch_mate_dev";
  const parsed = new URL(adminUrl);
  const adminConfig = {
    host: parsed.hostname,
    port: parsed.port === "" ? 5432 : Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: "postgres",
  };
  const testDb = "deutsch_mate_dm022_auth_test";
  const rolePassword = decodeURIComponent(parsed.password);

  let admin: pg.Client;
  let seed: SeedIds;

  async function connectDb(user: string): Promise<pg.Client> {
    const client = new pg.Client({
      ...adminConfig,
      database: testDb,
      user,
      password: rolePassword,
    });
    await client.connect();
    return client;
  }

  async function asApiUser(
    userId: string,
    roles: readonly string[],
    fn: (client: pg.Client) => Promise<void>,
  ): Promise<void> {
    const client = await connectDb("dm_api");
    try {
      await client.query("BEGIN");
      const context: TransactionAppContext = {
        userId,
        roles,
        correlationId: uuidV7(),
      };
      await setTransactionAppContext(client, context);
      await fn(client);
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    admin = new pg.Client(adminConfig);
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${testDb}"`);

    const migrator = new pg.Client({ ...adminConfig, database: testDb });
    await migrator.connect();
    try {
      await applyMigrations({
        client: migrator,
        migrationsDir: repoMigrations,
        localRolePassword: rolePassword,
      });
      seed = await seedFixture(migrator);
    } finally {
      await migrator.end();
    }
  }, 120_000);

  afterAll(async () => {
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
      await admin.end();
    }
  });

  it("covers every user-owned resource type with positive and negative SELECT", async () => {
    expect(USER_OWNED_RESOURCES.length).toBe(36);

    for (const resource of USER_OWNED_RESOURCES) {
      const ownId = seed[resource.idParam];
      const otherId =
        resource.idParam === "userA"
          ? seed.userB
          : resource.name.includes("onboarding") ||
              resource.name.includes("proficiency") ||
              resource.name.includes("unit_progress")
            ? seed.userB
            : resource.idParam.endsWith("A")
              ? seed[`${resource.idParam.slice(0, -1)}B` as keyof SeedIds]
              : seed.userB;

      await asApiUser(seed.userA, ["learner"], async (client) => {
        const { rows: own } = await client.query<{ n: number }>(resource.countSql, [ownId]);
        expect(own[0]?.n, `${resource.name} owner positive`).toBeGreaterThan(0);
      });

      await asApiUser(seed.userB, ["learner"], async (client) => {
        const { rows: denied } = await client.query<{ n: number }>(resource.countSql, [ownId]);
        expect(denied[0]?.n, `${resource.name} cross-user negative`).toBe(0);
      });

      // Sanity: otherId exists for mirrored resources when applicable
      void otherId;
    }
  });

  it("admin role is not an RLS bypass for another user's learning data", async () => {
    await asApiUser(seed.adminUser, ["admin", "learner"], async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM learning.sessions WHERE id = $1`,
        [seed.sessionA],
      );
      expect(rows[0]?.n).toBe(0);

      const { rows: profiles } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM learner.profile_versions WHERE id = $1`,
        [seed.profileA],
      );
      expect(profiles[0]?.n).toBe(0);
    });
  });

  it("deletion_pending users lose RLS access to own rows", async () => {
    const pending = await connectDb(adminConfig.user);
    try {
      await pending.query(`UPDATE iam.users SET status = 'deletion_pending' WHERE id = $1`, [
        seed.userA,
      ]);
    } finally {
      await pending.end();
    }

    await asApiUser(seed.userA, ["learner"], async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM learner.profile_versions WHERE id = $1`,
        [seed.profileA],
      );
      expect(rows[0]?.n).toBe(0);
    });

    const restore = await connectDb(adminConfig.user);
    try {
      await restore.query(`UPDATE iam.users SET status = 'active' WHERE id = $1`, [seed.userA]);
    } finally {
      await restore.end();
    }
  });

  it("billing worker cannot SELECT learning tables (privilege)", async () => {
    const client = await connectDb("dm_billing_worker");
    try {
      await expect(client.query(`SELECT 1 FROM learning.sessions LIMIT 1`)).rejects.toThrow(
        /permission denied|does not exist/i,
      );
    } finally {
      await client.end();
    }
  });

  it("AI worker cannot SELECT billing tables (privilege)", async () => {
    const client = await connectDb("dm_ai_worker");
    try {
      await expect(client.query(`SELECT 1 FROM billing.customers LIMIT 1`)).rejects.toThrow(
        /permission denied|does not exist/i,
      );
    } finally {
      await client.end();
    }
  });

  it("AI worker can read profile context view", async () => {
    const client = await connectDb("dm_ai_worker");
    try {
      const { rows } = await client.query<{ user_id: string }>(
        `SELECT user_id FROM learner.v_ai_profile_context WHERE user_id = $1`,
        [seed.userA],
      );
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await client.end();
    }
  });

  it("setTransactionAppContext rejects non-UUID user ids", async () => {
    const client = await connectDb("dm_api");
    try {
      await expect(
        setTransactionAppContext(client, {
          userId: "not-a-uuid",
          roles: ["learner"],
          correlationId: uuidV7(),
        }),
      ).rejects.toThrow(/Invalid userId/);
    } finally {
      await client.end();
    }
  });

  it("content_editor with active grant can read draft releases; learner cannot", async () => {
    const draftId = uuidV7();
    const owner = await connectDb(adminConfig.user);
    try {
      await owner.query(
        `INSERT INTO content.curriculum_releases (
           id, release_key, version, status, title, description, manifest_sha256, created_by
         ) VALUES ($1, 'draft-only', 1, 'draft', 'Draft', 'd', $2, $3)`,
        [draftId, sha256Hex("draft"), seed.userA],
      );
      await owner.query(
        `INSERT INTO iam.user_roles (id, user_id, role, reason)
         VALUES ($1, $2, 'content_editor', 'test')`,
        [uuidV7(), seed.userA],
      );
    } finally {
      await owner.end();
    }

    await asApiUser(seed.userA, ["learner", "content_editor"], async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM content.curriculum_releases WHERE id = $1`,
        [draftId],
      );
      expect(rows[0]?.n).toBe(1);
    });

    await asApiUser(seed.userB, ["learner"], async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM content.curriculum_releases WHERE id = $1`,
        [draftId],
      );
      expect(rows[0]?.n).toBe(0);
    });

    // admin without content_editor cannot read draft (not a bypass)
    await asApiUser(seed.adminUser, ["admin"], async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM content.curriculum_releases WHERE id = $1`,
        [draftId],
      );
      expect(rows[0]?.n).toBe(0);
    });
  });
});

async function seedFixture(client: pg.Client): Promise<SeedIds> {
  const ids: SeedIds = {
    userA: uuidV7(),
    userB: uuidV7(),
    adminUser: uuidV7(),
    mediaA: uuidV7(),
    mediaB: uuidV7(),
    profileA: uuidV7(),
    profileB: uuidV7(),
    sessionA: uuidV7(),
    sessionB: uuidV7(),
    attemptA: uuidV7(),
    attemptB: uuidV7(),
    responseA: uuidV7(),
    responseB: uuidV7(),
    scoreA: uuidV7(),
    scoreB: uuidV7(),
    feedbackA: uuidV7(),
    feedbackB: uuidV7(),
    evidenceA: uuidV7(),
    evidenceB: uuidV7(),
    reviewA: uuidV7(),
    reviewB: uuidV7(),
    recoA: uuidV7(),
    recoB: uuidV7(),
    threadA: uuidV7(),
    threadB: uuidV7(),
    runA: uuidV7(),
    runB: uuidV7(),
    messageA: uuidV7(),
    messageB: uuidV7(),
    traceA: uuidV7(),
    traceB: uuidV7(),
    customerA: uuidV7(),
    customerB: uuidV7(),
    checkoutA: uuidV7(),
    checkoutB: uuidV7(),
    subA: uuidV7(),
    subB: uuidV7(),
    entitlementA: uuidV7(),
    entitlementB: uuidV7(),
    entitlementEventA: uuidV7(),
    entitlementEventB: uuidV7(),
    usageA: uuidV7(),
    usageB: uuidV7(),
    privacyA: uuidV7(),
    privacyB: uuidV7(),
    privacyEventA: uuidV7(),
    privacyEventB: uuidV7(),
    erasureA: uuidV7(),
    erasureB: uuidV7(),
    caseA: uuidV7(),
    caseB: uuidV7(),
    caseEventA: uuidV7(),
    caseEventB: uuidV7(),
    identityA: uuidV7(),
    identityB: uuidV7(),
    roleA: uuidV7(),
    roleB: uuidV7(),
    consentA: uuidV7(),
    consentB: uuidV7(),
    idemA: uuidV7(),
    idemB: uuidV7(),
    auditA: uuidV7(),
    auditB: uuidV7(),
    releaseId: uuidV7(),
    unitId: uuidV7(),
    moduleId: uuidV7(),
    objectiveId: uuidV7(),
    lessonId: uuidV7(),
    activityId: uuidV7(),
    planId: uuidV7(),
    planPriceId: uuidV7(),
    aiReleaseId: uuidV7(),
    promptId: uuidV7(),
    modelConfigId: uuidV7(),
    checkpointNs: "",
    checkpointId: "cp-1",
  };

  await client.query("BEGIN");
  await client.query(`SET LOCAL app.maintenance_ticket = 'dm022-seed'`);

  for (const [userId, email] of [
    [ids.userA, "a@example.com"],
    [ids.userB, "b@example.com"],
    [ids.adminUser, "admin@example.com"],
  ] as const) {
    await client.query(
      `INSERT INTO iam.users (id, primary_email, pseudonym_key) VALUES ($1, $2, $3)`,
      [userId, email, uuidV7()],
    );
  }

  await client.query(
    `INSERT INTO iam.user_roles (id, user_id, role, reason) VALUES
       ($1, $2, 'learner', 'seed'),
       ($3, $4, 'learner', 'seed'),
       ($5, $6, 'admin', 'seed'),
       ($7, $6, 'learner', 'seed')`,
    [ids.roleA, ids.userA, ids.roleB, ids.userB, uuidV7(), ids.adminUser, uuidV7()],
  );

  await client.query(
    `INSERT INTO iam.user_identities (id, user_id, issuer, subject) VALUES
       ($1, $2, 'https://issuer.example', 'sub-a'),
       ($3, $4, 'https://issuer.example', 'sub-b')`,
    [ids.identityA, ids.userA, ids.identityB, ids.userB],
  );

  await client.query(
    `INSERT INTO media.objects (
       id, owner_user_id, data_class, bucket_alias, object_key, content_type, kms_key_alias
     ) VALUES
       ($1, $2, 'writing_attachment', 'user', $3, 'audio/mpeg', 'alias/local'),
       ($4, $5, 'writing_attachment', 'user', $6, 'audio/mpeg', 'alias/local')`,
    [ids.mediaA, ids.userA, `a-${ids.mediaA}`, ids.mediaB, ids.userB, `b-${ids.mediaB}`],
  );

  await client.query(
    `INSERT INTO iam.consent_events (
       id, user_id, purpose_code, decision, source, correlation_id
     ) VALUES
       ($1, $2, 'marketing', 'granted', 'web', $3),
       ($4, $5, 'marketing', 'granted', 'web', $6)`,
    [ids.consentA, ids.userA, uuidV7(), ids.consentB, ids.userB, uuidV7()],
  );

  await client.query(
    `INSERT INTO content.module_versions (
       id, module_key, version, level, title, description, ordinal, created_by
     ) VALUES ($1, 'm-auth', 1, 'A1', 'M', 'd', 1, $2)`,
    [ids.moduleId, ids.userA],
  );
  await client.query(
    `INSERT INTO content.unit_versions (
       id, unit_key, version, module_key, level, title, summary, ordinal,
       estimated_minutes, access_tier, created_by
     ) VALUES ($1, 'u-auth', 1, 'm-auth', 'A1', 'U', 's', 1, 20, 'free', $2)`,
    [ids.unitId, ids.userA],
  );
  await client.query(
    `INSERT INTO content.objective_versions (
       id, objective_key, version, level, skill, title, description, created_by
     ) VALUES ($1, 'o-auth', 1, 'A1', 'reading', 'O', 'd', $2)`,
    [ids.objectiveId, ids.userA],
  );
  await client.query(
    `INSERT INTO content.lesson_versions (
       id, lesson_key, version, unit_key, title, explanation, examples,
       completion_rule, estimated_minutes, created_by
     ) VALUES ($1, 'l-auth', 1, 'u-auth', 'L', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, 10, $2)`,
    [ids.lessonId, ids.userA],
  );
  await client.query(
    `INSERT INTO content.activity_versions (
       id, activity_key, version, type, level, prompt, configuration, max_score, created_by
     ) VALUES ($1, 'act-auth', 1, 'selection', 'A1', '{}'::jsonb, '{}'::jsonb, 1, $2)`,
    [ids.activityId, ids.userA],
  );
  await client.query(
    `INSERT INTO content.curriculum_releases (
       id, release_key, version, status, title, description, manifest_sha256,
       created_by, approved_at, approved_by, published_at, published_by
     ) VALUES ($1, 'rel-auth', 1, 'published', 'R', 'd', $2, $3, now(), $3, now(), $3)`,
    [ids.releaseId, sha256Hex("rel"), ids.userA],
  );
  await client.query(
    `INSERT INTO content.release_modules (release_id, module_version_id, ordinal)
     VALUES ($1, $2, 1)`,
    [ids.releaseId, ids.moduleId],
  );
  await client.query(
    `INSERT INTO content.module_units (module_version_id, unit_version_id, ordinal)
     VALUES ($1, $2, 1)`,
    [ids.moduleId, ids.unitId],
  );
  await client.query(
    `INSERT INTO content.unit_lessons (unit_version_id, lesson_version_id, ordinal)
     VALUES ($1, $2, 1)`,
    [ids.unitId, ids.lessonId],
  );
  await client.query(
    `INSERT INTO content.lesson_activities (lesson_version_id, activity_version_id, ordinal)
     VALUES ($1, $2, 1)`,
    [ids.lessonId, ids.activityId],
  );
  await client.query(
    `INSERT INTO content.unit_objectives (unit_version_id, objective_version_id)
     VALUES ($1, $2)`,
    [ids.unitId, ids.objectiveId],
  );

  await client.query(
    `INSERT INTO learner.profile_versions (id, user_id, version, goal, selected_level)
     VALUES ($1, $2, 1, 'general', 'A1'), ($3, $4, 1, 'general', 'A1')`,
    [ids.profileA, ids.userA, ids.profileB, ids.userB],
  );
  await client.query(
    `INSERT INTO learner.onboarding_states (user_id) VALUES ($1), ($2)`,
    [ids.userA, ids.userB],
  );
  await client.query(
    `INSERT INTO learner.proficiency_snapshots (
       id, user_id, sequence, algorithm_version, evidence_cutoff_at, skill_vector
     ) VALUES
       ($1, $2, 1, 'v1', now(), '{}'::jsonb),
       ($3, $4, 1, 'v1', now(), '{}'::jsonb)`,
    [uuidV7(), ids.userA, uuidV7(), ids.userB],
  );

  for (const [sessionId, userId] of [
    [ids.sessionA, ids.userA],
    [ids.sessionB, ids.userB],
  ] as const) {
    await client.query(
      `INSERT INTO learning.sessions (
         id, user_id, curriculum_release_id, unit_version_id, client_platform, last_activity_at
       ) VALUES ($1, $2, $3, $4, 'web', now())`,
      [sessionId, userId, ids.releaseId, ids.unitId],
    );
  }

  for (const [attemptId, userId, sessionId, clientAttempt] of [
    [ids.attemptA, ids.userA, ids.sessionA, uuidV7()],
    [ids.attemptB, ids.userB, ids.sessionB, uuidV7()],
  ] as const) {
    await client.query(
      `INSERT INTO learning.activity_attempts (
         id, user_id, session_id, activity_version_id, attempt_number, client_attempt_id,
         status, submitted_at, algorithm_version, correlation_id
       ) VALUES ($1, $2, $3, $4, 1, $5, 'submitted', now(), 'v1', $6)`,
      [attemptId, userId, sessionId, ids.activityId, clientAttempt, uuidV7()],
    );
  }

  await client.query(
    `INSERT INTO learning.attempt_responses (
       id, attempt_id, response_kind, response, sha256
     ) VALUES
       ($1, $2, 'structured', '{}'::jsonb, $3),
       ($4, $5, 'structured', '{}'::jsonb, $6)`,
    [ids.responseA, ids.attemptA, sha256Hex("ra"), ids.responseB, ids.attemptB, sha256Hex("rb")],
  );
  await client.query(
    `INSERT INTO learning.attempt_scores (
       id, attempt_id, score, max_score, passed, scoring_method, algorithm_version, details
     ) VALUES
       ($1, $2, 1, 1, true, 'deterministic', 'v1', '{}'::jsonb),
       ($3, $4, 1, 1, true, 'deterministic', 'v1', '{}'::jsonb)`,
    [ids.scoreA, ids.attemptA, ids.scoreB, ids.attemptB],
  );

  await client.query(
    `INSERT INTO ai.prompt_versions (
       id, prompt_key, version, feature, template, input_schema, output_schema,
       safety_policy_version, sha256, status, created_by
     ) VALUES ($1, 'p-auth', 1, 'tutor_chat', 't', '{}'::jsonb, '{}'::jsonb, 's1', $2, 'published', $3)`,
    [ids.promptId, sha256Hex("prompt"), ids.userA],
  );
  await client.query(
    `INSERT INTO ai.model_config_versions (
       id, config_key, version, provider, model_name, parameters, max_input_tokens,
       max_output_tokens, timeout_ms, data_policy_code, created_by
     ) VALUES ($1, 'mc-auth', 1, 'openai', 'gpt-test', '{}'::jsonb, 1000, 500, 30000, 'eu', $2)`,
    [ids.modelConfigId, ids.userA],
  );
  await client.query(
    `INSERT INTO ai.releases (
       id, feature, version, prompt_version_id, model_config_version_id, status,
       evaluation_result, created_by, approved_at, approved_by, published_at, published_by
     ) VALUES ($1, 'tutor_chat', 1, $2, $3, 'published', '{}'::jsonb, $4, now(), $4, now(), $4)`,
    [ids.aiReleaseId, ids.promptId, ids.modelConfigId, ids.userA],
  );

  for (const [threadId, userId] of [
    [ids.threadA, ids.userA],
    [ids.threadB, ids.userB],
  ] as const) {
    await client.query(
      `INSERT INTO ai.threads (id, user_id, feature, retention_until)
       VALUES ($1, $2, 'tutor_chat', now() + interval '30 days')`,
      [threadId, userId],
    );
  }

  for (const [runId, threadId, userId, attemptId] of [
    [ids.runA, ids.threadA, ids.userA, ids.attemptA],
    [ids.runB, ids.threadB, ids.userB, ids.attemptB],
  ] as const) {
    await client.query(
      `INSERT INTO ai.runs (
         id, thread_id, user_id, release_id, attempt_id, status, trace_id, correlation_id,
         started_at, content_expires_at
       ) VALUES ($1, $2, $3, $4, $5, 'succeeded', $6, $7, now(), now() + interval '30 days')`,
      [runId, threadId, userId, ids.aiReleaseId, attemptId, uuidV7(), uuidV7()],
    );
  }

  await client.query(
    `INSERT INTO learning.feedback_records (
       id, attempt_id, ai_run_id, feedback_kind, feedback
     ) VALUES
       ($1, $2, $3, 'ai', '{}'::jsonb),
       ($4, $5, $6, 'ai', '{}'::jsonb)`,
    [ids.feedbackA, ids.attemptA, ids.runA, ids.feedbackB, ids.attemptB, ids.runB],
  );

  await client.query(
    `INSERT INTO learning.evidence (
       id, user_id, attempt_id, objective_version_id, score_ratio, validity,
       reason_code, observed_at, algorithm_version
     ) VALUES
       ($1, $2, $3, $4, 1, 'valid', 'ok', now(), 'v1'),
       ($5, $6, $7, $4, 1, 'valid', 'ok', now(), 'v1')`,
    [
      ids.evidenceA,
      ids.userA,
      ids.attemptA,
      ids.objectiveId,
      ids.evidenceB,
      ids.userB,
      ids.attemptB,
    ],
  );

  await client.query(
    `INSERT INTO learning.review_items (
       id, user_id, objective_version_id, source_attempt_id, algorithm_version,
       due_at, interval_days, ease, state, last_evidence_id
     ) VALUES
       ($1, $2, $3, $4, 'v1', now(), 1, 2.5, 'due', $5),
       ($6, $7, $3, $8, 'v1', now(), 1, 2.5, 'due', $9)`,
    [
      ids.reviewA,
      ids.userA,
      ids.objectiveId,
      ids.attemptA,
      ids.evidenceA,
      ids.reviewB,
      ids.userB,
      ids.attemptB,
      ids.evidenceB,
    ],
  );

  await client.query(
    `INSERT INTO learning.recommendation_runs (
       id, user_id, algorithm_version, profile_version_id, entitlement_snapshot,
       candidate_snapshot, kind, recommended_unit_version_id, reason_codes
     ) VALUES
       ($1, $2, 'v1', $3, '{}'::jsonb, '[]'::jsonb, 'lesson', $7, ARRAY['seed']),
       ($4, $5, 'v1', $6, '{}'::jsonb, '[]'::jsonb, 'lesson', $7, ARRAY['seed'])`,
    [ids.recoA, ids.userA, ids.profileA, ids.recoB, ids.userB, ids.profileB, ids.unitId],
  );

  await client.query(
    `INSERT INTO learning.unit_progress (
       user_id, unit_version_id, completed_required, required_total, completion_ratio
     ) VALUES
       ($1, $2, 0, 1, 0),
       ($3, $2, 0, 1, 0)`,
    [ids.userA, ids.unitId, ids.userB],
  );

  await client.query(
    `INSERT INTO ai.messages (
       id, run_id, sequence, role, content, content_sha256, redaction_summary, expires_at
     ) VALUES
       ($1, $2, 1, 'user', 'hi', $3, '{}'::jsonb, now() + interval '30 days'),
       ($4, $5, 1, 'user', 'hi', $6, '{}'::jsonb, now() + interval '30 days')`,
    [ids.messageA, ids.runA, sha256Hex("ma"), ids.messageB, ids.runB, sha256Hex("mb")],
  );

  await client.query(
    `INSERT INTO ai.trace_events (
       id, run_id, sequence, event_type, name, metadata, started_at
     ) VALUES
       ($1, $2, 1, 'model_call', 'call', '{}'::jsonb, now()),
       ($3, $4, 1, 'model_call', 'call', '{}'::jsonb, now())`,
    [ids.traceA, ids.runA, ids.traceB, ids.runB],
  );

  await client.query(
    `INSERT INTO ai.langgraph_checkpoints (
       thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata, channel_versions
     ) VALUES
       ($1, '', $2, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb),
       ($3, '', $2, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
    [ids.threadA, ids.checkpointId, ids.threadB],
  );
  await client.query(
    `INSERT INTO ai.langgraph_writes (
       thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value
     ) VALUES
       ($1, '', $2, 't1', 0, 'ch', '{}'::jsonb),
       ($3, '', $2, 't1', 0, 'ch', '{}'::jsonb)`,
    [ids.threadA, ids.checkpointId, ids.threadB],
  );

  await client.query(
    `INSERT INTO billing.plans (id, plan_code, name) VALUES ($1, 'free', 'Free')`,
    [ids.planId],
  );
  await client.query(
    `INSERT INTO billing.plan_prices (
       id, plan_id, provider, currency, amount_minor, billing_interval, tax_behavior, effective_from
     ) VALUES ($1, $2, 'stripe', 'EUR', 0, 'none', 'unspecified', now())`,
    [ids.planPriceId, ids.planId],
  );

  await client.query(
    `INSERT INTO ops.idempotency_keys (
       id, scope, actor_user_id, key, request_hash, state, locked_until, expires_at
     ) VALUES
       ($1, 'checkout', $2, 'k-a', $3, 'completed', now(), now() + interval '1 day'),
       ($4, 'checkout', $5, 'k-b', $6, 'completed', now(), now() + interval '1 day')`,
    [ids.idemA, ids.userA, sha256Hex("ia"), ids.idemB, ids.userB, sha256Hex("ib")],
  );

  await client.query(
    `INSERT INTO billing.customers (id, user_id, provider, provider_customer_id) VALUES
       ($1, $2, 'stripe', 'cus_a'),
       ($3, $4, 'stripe', 'cus_b')`,
    [ids.customerA, ids.userA, ids.customerB, ids.userB],
  );
  await client.query(
    `INSERT INTO billing.checkout_sessions (
       id, user_id, plan_price_id, status, success_url_hash, cancel_url_hash,
       expires_at, idempotency_key_id
     ) VALUES
       ($1, $2, $3, 'completed', $4, $5, now() + interval '1 hour', $6),
       ($7, $8, $3, 'completed', $9, $10, now() + interval '1 hour', $11)`,
    [
      ids.checkoutA,
      ids.userA,
      ids.planPriceId,
      sha256Hex("sa"),
      sha256Hex("ca"),
      ids.idemA,
      ids.checkoutB,
      ids.userB,
      sha256Hex("sb"),
      sha256Hex("cb"),
      ids.idemB,
    ],
  );
  await client.query(
    `INSERT INTO billing.subscriptions (
       id, customer_id, provider_subscription_id, plan_price_id, status, provider_event_created_at,
       provider_snapshot
     ) VALUES
       ($1, $2, 'sub_a', $3, 'active', now(), '{}'::jsonb),
       ($4, $5, 'sub_b', $3, 'active', now(), '{}'::jsonb)`,
    [ids.subA, ids.customerA, ids.planPriceId, ids.subB, ids.customerB],
  );
  await client.query(
    `INSERT INTO billing.entitlements (
       id, user_id, feature_code, source_provider, source_subscription_id, status,
       valid_from, allowance
     ) VALUES
       ($1, $2, 'premium', 'stripe', $3, 'active', now(), '{}'::jsonb),
       ($4, $5, 'premium', 'stripe', $6, 'active', now(), '{}'::jsonb)`,
    [ids.entitlementA, ids.userA, ids.subA, ids.entitlementB, ids.userB, ids.subB],
  );
  await client.query(
    `INSERT INTO billing.entitlement_events (
       id, entitlement_id, action, before_state, after_state, reason_code
     ) VALUES
       ($1, $2, 'grant', '{}'::jsonb, '{}'::jsonb, 'seed'),
       ($3, $4, 'grant', '{}'::jsonb, '{}'::jsonb, 'seed')`,
    [ids.entitlementEventA, ids.entitlementA, ids.entitlementEventB, ids.entitlementB],
  );
  await client.query(
    `INSERT INTO billing.usage_events (
       id, user_id, entitlement_id, feature_code, quantity, unit, period_start, period_end,
       source_type, source_id, idempotency_key
     ) VALUES
       ($1, $2, $3, 'premium', 1, 'request', now(), now() + interval '1 month', 'attempt', $4, 'u-a'),
       ($5, $6, $7, 'premium', 1, 'request', now(), now() + interval '1 month', 'attempt', $8, 'u-b')`,
    [
      ids.usageA,
      ids.userA,
      ids.entitlementA,
      ids.attemptA,
      ids.usageB,
      ids.userB,
      ids.entitlementB,
      ids.attemptB,
    ],
  );

  await client.query(
    `INSERT INTO privacy.requests (id, user_id, type, due_at, retention_exceptions) VALUES
       ($1, $2, 'export', now() + interval '30 days', '{}'::jsonb),
       ($3, $4, 'export', now() + interval '30 days', '{}'::jsonb)`,
    [ids.privacyA, ids.userA, ids.privacyB, ids.userB],
  );
  await client.query(
    `INSERT INTO privacy.request_events (
       id, request_id, to_status, details
     ) VALUES
       ($1, $2, 'requested', '{}'::jsonb),
       ($3, $4, 'requested', '{}'::jsonb)`,
    [ids.privacyEventA, ids.privacyA, ids.privacyEventB, ids.privacyB],
  );
  await client.query(
    `INSERT INTO privacy.erasure_tasks (id, request_id, system_code, status, evidence) VALUES
       ($1, $2, 'postgres', 'pending', '{}'::jsonb),
       ($3, $4, 'postgres', 'pending', '{}'::jsonb)`,
    [ids.erasureA, ids.privacyA, ids.erasureB, ids.privacyB],
  );

  await client.query(
    `INSERT INTO support.cases (
       id, user_id, category, subject, description
     ) VALUES
       ($1, $2, 'account', 'A', 'desc'),
       ($3, $4, 'account', 'B', 'desc')`,
    [ids.caseA, ids.userA, ids.caseB, ids.userB],
  );
  await client.query(
    `INSERT INTO support.case_events (id, case_id, event_type, body, metadata) VALUES
       ($1, $2, 'created', 'hi', '{}'::jsonb),
       ($3, $4, 'created', 'hi', '{}'::jsonb)`,
    [ids.caseEventA, ids.caseA, ids.caseEventB, ids.caseB],
  );

  await client.query(
    `INSERT INTO ops.audit_events (
       id, actor_user_id, actor_type, action, resource_type, outcome, correlation_id,
       metadata, event_hash
     ) VALUES
       ($1, $2, 'user', 'read', 'profile', 'success', $3, '{}'::jsonb, $4),
       ($5, $6, 'user', 'read', 'profile', 'success', $7, '{}'::jsonb, $8)`,
    [
      ids.auditA,
      ids.userA,
      uuidV7(),
      sha256Hex("aa"),
      ids.auditB,
      ids.userB,
      uuidV7(),
      sha256Hex("ab"),
    ],
  );

  await client.query("COMMIT");
  return ids;
}
