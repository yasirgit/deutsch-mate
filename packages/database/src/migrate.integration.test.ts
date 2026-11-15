import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyMigrations,
  discoverMigrationFiles,
  formatPgTimeout,
  MIGRATION_FILE_PATTERN,
  MIGRATOR_ROLE,
  RUNTIME_LOGIN_ROLES,
  sha256Hex,
  verifyMigrations,
} from "./index.js";

const repoMigrations = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../migrations",
);

describe("migration discovery and checksums", () => {
  it("accepts the forward-only filename pattern", () => {
    expect(MIGRATION_FILE_PATTERN.test("0001_extensions_roles.sql")).toBe(true);
    expect(MIGRATION_FILE_PATTERN.test("0002_mvp_schema.sql")).toBe(true);
    expect(MIGRATION_FILE_PATTERN.test("1_bad.sql")).toBe(false);
    expect(MIGRATION_FILE_PATTERN.test("0001_Bad.sql")).toBe(false);
    expect(MIGRATION_FILE_PATTERN.test("0001_extensions-roles.sql")).toBe(false);
  });

  it("hashes exact file bytes as lowercase hex", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("formats PostgreSQL timeout intervals", () => {
    expect(formatPgTimeout(5_000)).toBe("5000ms");
    expect(formatPgTimeout(60_000)).toBe("60000ms");
    expect(() => formatPgTimeout(-1)).toThrow(/non-negative/);
  });

  it("discovers migrations in lexical order", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dm-migrations-"));
    try {
      await writeFile(path.join(dir, "0002_second.sql"), "SELECT 2;\n");
      await writeFile(path.join(dir, "0001_first.sql"), "SELECT 1;\n");
      const discovered = await discoverMigrationFiles(dir);
      expect(discovered.map((item) => item.name)).toEqual(["0001_first.sql", "0002_second.sql"]);
      expect(discovered[0]?.sha256).toBe(sha256Hex("SELECT 1;\n"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid migration filenames", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dm-migrations-bad-"));
    try {
      await writeFile(path.join(dir, "not_a_migration.sql"), "SELECT 1;\n");
      await expect(discoverMigrationFiles(dir)).rejects.toThrow(/Invalid migration filename/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("migration runner integration", () => {
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
  const testDb = "deutsch_mate_dm020_test";
  // repoMigrations is resolved once at module load (repository-root migrations/).

  let admin: pg.Client;

  async function connectTestDb(): Promise<pg.Client> {
    const client = new pg.Client({ ...adminConfig, database: testDb });
    await client.connect();
    return client;
  }

  beforeAll(async () => {
    admin = new pg.Client(adminConfig);
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${testDb}"`);
  }, 30_000);

  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
    await admin.end();
  });

  it("applies repository migrations, records the ledger, and is idempotent on re-run", async () => {
    const client = await connectTestDb();
    try {
      const discovered = await discoverMigrationFiles(repoMigrations);
      const expectedNames = discovered.map((migration) => migration.name);
      expect(expectedNames[0]).toBe("0001_extensions_roles.sql");
      expect(expectedNames.length).toBeGreaterThanOrEqual(2);

      const first = await applyMigrations({
        client,
        migrationsDir: repoMigrations,
        actorContext: { actor: "dm020-test", deployedCommit: "testcommit" },
        localRolePassword: "local-dev-only-not-a-secret",
        timeouts: { lockTimeoutMs: 5_000, statementTimeoutMs: 60_000 },
      });
      expect(first.applied).toEqual(expectedNames);
      expect(first.skipped).toEqual([]);

      const verified = await verifyMigrations(client, repoMigrations);
      expect(verified.ok).toBe(true);
      expect(verified.migrations).toHaveLength(expectedNames.length);
      expect(verified.migrations[0]?.name).toBe("0001_extensions_roles.sql");
      expect(verified.migrations[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);

      const second = await applyMigrations({
        client,
        migrationsDir: repoMigrations,
        actorContext: { actor: "dm020-test", deployedCommit: "testcommit" },
      });
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(expectedNames);

      const { rows: ledger } = await client.query<{
        name: string;
        sha256: string;
        actor: string;
        deployed_commit: string | null;
      }>(`SELECT name, sha256, actor, deployed_commit FROM ops.schema_migrations ORDER BY name`);
      expect(ledger).toHaveLength(expectedNames.length);
      expect(ledger[0]?.actor).toBe("dm020-test");
      expect(ledger[0]?.deployed_commit).toBe("testcommit");
    } finally {
      await client.end();
    }
  });

  it("creates required extensions, schemas, and roles", async () => {
    const client = await connectTestDb();
    try {
      const { rows: extensions } = await client.query<{ extname: string }>(
        `SELECT extname FROM pg_extension WHERE extname = ANY($1) ORDER BY extname`,
        [["pgcrypto", "citext", "btree_gist"]],
      );
      expect(extensions.map((row) => row.extname)).toEqual(["btree_gist", "citext", "pgcrypto"]);

      const expectedSchemas = [
        "ai",
        "billing",
        "content",
        "iam",
        "learner",
        "learning",
        "media",
        "ops",
        "privacy",
        "support",
      ];
      const { rows: schemas } = await client.query<{ nspname: string }>(
        `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1) ORDER BY nspname`,
        [expectedSchemas],
      );
      expect(schemas.map((row) => row.nspname)).toEqual(expectedSchemas);

      const expectedRoles = [MIGRATOR_ROLE, ...RUNTIME_LOGIN_ROLES];
      const { rows: roles } = await client.query<{ rolname: string; rolcanlogin: boolean }>(
        `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
        [[...expectedRoles]],
      );
      expect(roles.map((row) => row.rolname).sort()).toEqual([...expectedRoles].sort());
      expect(roles.find((row) => row.rolname === MIGRATOR_ROLE)?.rolcanlogin).toBe(false);
      for (const role of RUNTIME_LOGIN_ROLES) {
        expect(roles.find((row) => row.rolname === role)?.rolcanlogin).toBe(true);
      }
    } finally {
      await client.end();
    }
  });

  it("refuses to apply when a recorded migration checksum changed", async () => {
    const client = await connectTestDb();
    const tamperedDir = await mkdtemp(path.join(os.tmpdir(), "dm-migrations-tamper-"));
    try {
      const original = await discoverMigrationFiles(repoMigrations);
      const first = original[0];
      if (first === undefined) {
        throw new Error("Expected repository migrations to include 0001.");
      }
      await writeFile(path.join(tamperedDir, first.name), `${first.sql}\n-- tampered\n`);

      await expect(
        applyMigrations({
          client,
          migrationsDir: tamperedDir,
          actorContext: { actor: "dm020-test" },
        }),
      ).rejects.toThrow(/Checksum mismatch/);
    } finally {
      await client.end();
      await rm(tamperedDir, { recursive: true, force: true });
    }
  });

  it("sets lock_timeout and statement_timeout inside the migration transaction", async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${testDb}"`);

    const probeDir = await mkdtemp(path.join(os.tmpdir(), "dm-migrations-timeout-"));
    await mkdir(probeDir, { recursive: true });
    // Capture transaction-local settings while the migration SQL executes.
    const probeSql = `
      CREATE SCHEMA IF NOT EXISTS ops;
      CREATE TABLE IF NOT EXISTS ops.schema_migrations (
        name text NOT NULL UNIQUE,
        sha256 char(64) NOT NULL,
        deployed_commit text,
        actor text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS ops.timeout_probe (
        lock_timeout text NOT NULL,
        statement_timeout text NOT NULL
      );
      INSERT INTO ops.timeout_probe (lock_timeout, statement_timeout)
      VALUES (current_setting('lock_timeout'), current_setting('statement_timeout'));
    `;
    await writeFile(path.join(probeDir, "0001_timeout_probe.sql"), probeSql);

    const client = await connectTestDb();
    try {
      await applyMigrations({
        client,
        migrationsDir: probeDir,
        actorContext: { actor: "dm020-timeout" },
        timeouts: { lockTimeoutMs: 4_000, statementTimeoutMs: 45_000 },
      });
      const { rows } = await client.query<{ lock_timeout: string; statement_timeout: string }>(
        `SELECT lock_timeout, statement_timeout FROM ops.timeout_probe`,
      );
      expect(rows[0]?.lock_timeout).toBe("4s");
      expect(rows[0]?.statement_timeout).toBe("45s");
    } finally {
      await client.end();
      await rm(probeDir, { recursive: true, force: true });
      // Restore the canonical 0001 apply for any later suite use.
      await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${testDb}"`);
      const restore = await connectTestDb();
      try {
        await applyMigrations({
          client: restore,
          migrationsDir: repoMigrations,
          actorContext: { actor: "dm020-test" },
          localRolePassword: "local-dev-only-not-a-secret",
        });
      } finally {
        await restore.end();
      }
    }
  });

  it("applies a second migration under dm_migrator after 0001", async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${testDb}"`);

    const dir = await mkdtemp(path.join(os.tmpdir(), "dm-migrations-second-"));
    const client = await connectTestDb();
    try {
      const original = await discoverMigrationFiles(repoMigrations);
      const first = original[0];
      if (first === undefined) {
        throw new Error("Expected 0001.");
      }
      await writeFile(path.join(dir, first.name), first.sql);

      const bootstrap = await applyMigrations({
        client,
        migrationsDir: dir,
        actorContext: { actor: "dm020-second-bootstrap" },
        localRolePassword: "local-dev-only-not-a-secret",
      });
      expect(bootstrap.applied).toEqual(["0001_extensions_roles.sql"]);

      await writeFile(
        path.join(dir, "0002_forward_only_probe.sql"),
        `CREATE TABLE ops.forward_probe (id int PRIMARY KEY);\n`,
      );

      const result = await applyMigrations({
        client,
        migrationsDir: dir,
        actorContext: { actor: "dm020-second" },
      });
      expect(result.skipped).toContain("0001_extensions_roles.sql");
      expect(result.applied).toEqual(["0002_forward_only_probe.sql"]);

      const { rows } = await client.query<{ relname: string }>(
        `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ops' AND c.relname = 'forward_probe'`,
      );
      expect(rows).toHaveLength(1);

      const { rows: owner } = await client.query<{ tableowner: string }>(
        `SELECT tableowner FROM pg_tables WHERE schemaname = 'ops' AND tablename = 'forward_probe'`,
      );
      expect(owner[0]?.tableowner).toBe(MIGRATOR_ROLE);
    } finally {
      await client.end();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
