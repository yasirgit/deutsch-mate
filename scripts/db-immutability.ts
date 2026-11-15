/**
 * Asserts UPDATE/DELETE fail on append-only and immutable tables
 * (SQLSTATE 55000 via ops.forbid_mutation) and that maintenance bypass works
 * (DM-021; docs/Database.md §7).
 */

import { randomUUID } from "node:crypto";

import pg from "pg";

import { loadLocalEnv } from "./lib/env.ts";
import { waitForPostgres } from "./wait-for-services.ts";

/** UUIDv7-shaped placeholder (version nibble = 7). */
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

async function expectMutationDenied(
  client: pg.Client,
  label: string,
  sql: string,
  params: unknown[],
): Promise<string | null> {
  const sp = `sp_${label.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    await client.query(sql, params);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return `${label}: expected UPDATE/DELETE to fail with 55000`;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    const pgError = error as { code?: string };
    if (pgError.code !== "55000") {
      return `${label}: expected SQLSTATE 55000, got ${pgError.code ?? "unknown"} (${String(error)})`;
    }
    return null;
  }
}

async function main(): Promise<void> {
  const env = loadLocalEnv();
  await waitForPostgres(env, 15_000);
  const client = new pg.Client(env.postgres);
  await client.connect();
  const errors: string[] = [];

  const userId = uuidV7();
  const mediaId = uuidV7();
  const consentId = uuidV7();
  const profileId = uuidV7();
  const moduleId = uuidV7();
  const auditId = uuidV7();

  try {
    await client.query("BEGIN");

    await client.query(`INSERT INTO iam.users (id, pseudonym_key) VALUES ($1, $2)`, [
      userId,
      uuidV7(),
    ]);

    await client.query(
      `INSERT INTO media.objects (
         id, data_class, bucket_alias, object_key, content_type, kms_key_alias
       ) VALUES ($1, 'audit_export', 'audit', $2, 'application/json', 'alias/local')`,
      [mediaId, `key-${mediaId}`],
    );

    await client.query(
      `INSERT INTO iam.consent_events (
         id, user_id, purpose_code, decision, source, correlation_id
       ) VALUES ($1, $2, 'marketing', 'granted', 'web', $3)`,
      [consentId, userId, uuidV7()],
    );

    await client.query(
      `INSERT INTO learner.profile_versions (
         id, user_id, version, goal, selected_level
       ) VALUES ($1, $2, 1, 'general', 'A1')`,
      [profileId, userId],
    );

    await client.query(
      `INSERT INTO content.module_versions (
         id, module_key, version, level, title, description, ordinal, created_by
       ) VALUES ($1, 'm1', 1, 'A1', 'Module', 'Desc', 1, $2)`,
      [moduleId, userId],
    );

    await client.query(
      `INSERT INTO ops.audit_events (
         id, actor_type, action, resource_type, outcome, correlation_id,
         metadata, event_hash
       ) VALUES ($1, 'service', 'schema.test', 'ops', 'success', $2, '{}'::jsonb, $3)`,
      [auditId, uuidV7(), sha256Hex("a")],
    );

    for (const check of [
      await expectMutationDenied(
        client,
        "consent_events UPDATE",
        `UPDATE iam.consent_events SET purpose_code = 'other' WHERE id = $1`,
        [consentId],
      ),
      await expectMutationDenied(
        client,
        "consent_events DELETE",
        `DELETE FROM iam.consent_events WHERE id = $1`,
        [consentId],
      ),
      await expectMutationDenied(
        client,
        "profile_versions UPDATE",
        `UPDATE learner.profile_versions SET goal = 'work' WHERE id = $1`,
        [profileId],
      ),
      await expectMutationDenied(
        client,
        "profile_versions DELETE",
        `DELETE FROM learner.profile_versions WHERE id = $1`,
        [profileId],
      ),
      await expectMutationDenied(
        client,
        "module_versions UPDATE",
        `UPDATE content.module_versions SET title = 'X' WHERE id = $1`,
        [moduleId],
      ),
      await expectMutationDenied(
        client,
        "module_versions DELETE",
        `DELETE FROM content.module_versions WHERE id = $1`,
        [moduleId],
      ),
      await expectMutationDenied(
        client,
        "audit_events UPDATE",
        `UPDATE ops.audit_events SET action = 'tamper' WHERE id = $1`,
        [auditId],
      ),
      await expectMutationDenied(
        client,
        "audit_events DELETE",
        `DELETE FROM ops.audit_events WHERE id = $1`,
        [auditId],
      ),
    ]) {
      if (check !== null) {
        errors.push(check);
      }
    }

    await client.query(`SET LOCAL app.maintenance_ticket = 'DM-021-verify'`);
    try {
      await client.query(`UPDATE ops.audit_events SET reason_code = 'maint' WHERE id = $1`, [
        auditId,
      ]);
      await client.query(`DELETE FROM ops.audit_events WHERE id = $1`, [auditId]);
    } catch (error) {
      errors.push(`maintenance bypass failed: ${String(error)}`);
    }

    try {
      await client.query(
        `UPDATE iam.users SET interface_locale = 'de', lock_version = lock_version + 1 WHERE id = $1`,
        [userId],
      );
    } catch (error) {
      errors.push(`mutable iam.users UPDATE unexpectedly failed: ${String(error)}`);
    }

    await client.query("ROLLBACK");

    if (errors.length > 0) {
      console.error("[db:immutability] FAILED:");
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    console.log(
      "[db:immutability] OK — append-only UPDATE/DELETE denied (55000); maintenance bypass works; mutable tables remain writable.",
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("[db:immutability] Error:", error);
  process.exit(1);
});
