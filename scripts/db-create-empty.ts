import { createEmptyDatabase } from "./lib/db-ops.ts";

async function main(): Promise<void> {
  const database = await createEmptyDatabase();
  console.log(`[db:create-empty] "${database}" is empty (run pnpm db:migrate next).`);
}

main().catch((error: unknown) => {
  console.error(`[db:create-empty] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
