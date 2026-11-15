import { createEmptyDatabase, migrateDatabase } from "./lib/db-ops.ts";

/**
 * DX default: recreate an empty database, then apply all migrations.
 * Extensions are owned by migrations/0001_extensions_roles.sql (DM-020).
 */
async function main(): Promise<void> {
  console.log("[db:reset] Creating empty database...");
  await createEmptyDatabase();
  console.log("[db:reset] Applying migrations...");
  await migrateDatabase();
  console.log("[db:reset] Done.");
}

main().catch((error: unknown) => {
  console.error(`[db:reset] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
