import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Forward-only SQL migration filenames: `NNNN_snake_case.sql`. */
export const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface DiscoveredMigration {
  readonly name: string;
  readonly absolutePath: string;
  readonly sha256: string;
  readonly sql: string;
}

/** SHA-256 of exact file bytes as lowercase hex (docs/Database.md §12). */
export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Lists migration SQL files in lexical order. Rejects files that do not match
 * {@link MIGRATION_FILE_PATTERN}.
 */
export async function discoverMigrationFiles(
  migrationsDir: string,
): Promise<readonly DiscoveredMigration[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const discovered: DiscoveredMigration[] = [];
  for (const name of names) {
    if (!MIGRATION_FILE_PATTERN.test(name)) {
      throw new Error(
        `Invalid migration filename "${name}". Expected pattern ${MIGRATION_FILE_PATTERN.source}.`,
      );
    }
    const absolutePath = path.join(migrationsDir, name);
    const bytes = await readFile(absolutePath);
    discovered.push({
      name,
      absolutePath,
      sha256: sha256Hex(bytes),
      sql: bytes.toString("utf8"),
    });
  }
  return discovered;
}
