import { verifyDatabaseMigrations } from "./lib/db-ops.ts";

async function main(): Promise<void> {
  await verifyDatabaseMigrations();
}

main().catch((error: unknown) => {
  console.error(`[db:migrations:verify] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
