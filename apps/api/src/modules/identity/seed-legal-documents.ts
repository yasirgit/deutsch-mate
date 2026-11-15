/**
 * Seed helper for iam.legal_document_versions (DM-036).
 * Inserts a placeholder media.objects row + legal document version as DB owner.
 * Used by tests and local scripts — not a production content pipeline.
 */

import { createUuidV7 } from "@deutsch-mate/domain";
import type { Database } from "@deutsch-mate/database";
import { sql, type Kysely } from "kysely";

export interface SeedLegalDocumentInput {
  readonly createdByUserId: string;
  readonly documentCode: "terms" | "privacy" | "marketing";
  readonly version?: number;
  readonly locale?: string;
  readonly sha256?: string;
}

export async function seedLegalDocumentVersion(
  db: Kysely<Database>,
  input: SeedLegalDocumentInput,
): Promise<string> {
  const mediaId = createUuidV7();
  const docId = createUuidV7();
  const version = input.version ?? 1;
  const locale = input.locale ?? "en";
  const sha256 =
    input.sha256 ??
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  await sql`
    INSERT INTO media.objects (
      id,
      data_class,
      bucket_alias,
      object_key,
      state,
      content_type,
      kms_key_alias,
      sha256
    )
    VALUES (
      ${mediaId}::uuid,
      'audit_export'::media.data_class,
      'legal',
      ${`legal/${input.documentCode}/v${version}/${locale}.txt`},
      'available'::media.object_state,
      'text/plain',
      'alias/dm-local',
      ${sha256}
    )
  `.execute(db);

  await sql`
    INSERT INTO iam.legal_document_versions (
      id,
      document_code,
      version,
      locale,
      s3_object_id,
      sha256,
      published_at,
      effective_at,
      created_by
    )
    VALUES (
      ${docId}::uuid,
      ${input.documentCode},
      ${version},
      ${locale},
      ${mediaId}::uuid,
      ${sha256},
      now(),
      now(),
      ${input.createdByUserId}::uuid
    )
  `.execute(db);

  return docId;
}
