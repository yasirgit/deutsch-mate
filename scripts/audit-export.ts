/**
 * Audit export job stub (DM-023).
 *
 * Loads a time-window of ops.audit_events, verifies the hash chain, and writes
 * a JSON manifest. Production uploads a signed daily manifest to S3 Object Lock.
 *
 * Usage:
 *   pnpm audit:export
 *   pnpm audit:export -- --from 2026-07-29T00:00:00.000Z --to 2026-07-30T00:00:00.000Z
 */

import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createKysely, createPgPool, exportAuditEvents } from "@deutsch-mate/database";

import { loadLocalEnv } from "./lib/env.ts";

function parseArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const env = loadLocalEnv();
  const fromRaw = parseArg("from");
  const toRaw = parseArg("to");
  const outRaw = parseArg("out");

  const pool = createPgPool({ connectionString: env.databaseUrl });
  const db = createKysely({ pool });
  try {
    const exportOptions: {
      fromOccurredAt?: Date;
      toOccurredAt?: Date;
    } = {};
    if (fromRaw !== undefined) {
      exportOptions.fromOccurredAt = new Date(fromRaw);
    }
    if (toRaw !== undefined) {
      exportOptions.toOccurredAt = new Date(toRaw);
    }
    const manifest = await exportAuditEvents(db, exportOptions);

    if (!manifest.chainValid) {
      console.error("[audit:export] Hash chain validation failed.");
      process.exitCode = 1;
    }

    const outPath =
      outRaw ??
      path.join(
        os.tmpdir(),
        `dm-audit-export-${manifest.exportedAt.replace(/[:.]/g, "-")}.json`,
      );

    const serializable = {
      ...manifest,
      events: manifest.events.map((event) => ({
        ...event,
        occurred_at:
          event.occurred_at instanceof Date
            ? event.occurred_at.toISOString()
            : event.occurred_at,
        created_at:
          event.created_at instanceof Date
            ? event.created_at.toISOString()
            : event.created_at,
      })),
    };

    await writeFile(outPath, `${JSON.stringify(serializable, null, 2)}\n`, "utf8");
    console.log(
      `[audit:export] Wrote ${String(manifest.eventCount)} event(s) to ${outPath} ` +
        `(chainValid=${String(manifest.chainValid)}).`,
    );
    console.log(
      "[audit:export] Production: upload signed manifest to S3 Object Lock (not implemented here).",
    );
  } finally {
    await db.destroy();
  }
}

void main();
