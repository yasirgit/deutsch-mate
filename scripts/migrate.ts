import { migrateDatabase } from "./lib/db-ops.ts";

async function main(): Promise<void> {
  await migrateDatabase();
}

main().catch((error: unknown) => {
  console.error(`[db:migrate] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
