/**
 * Protected curriculum release governance (DM-031).
 *
 * Lifecycle: draft → (submitted) → approved|rejected → published; only one
 * published current; rollback reselects a prior published/approved release
 * without rewriting immutable content history.
 *
 * Actor identity comes only from AuthContext (never body/path/query).
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  appendAuditEvent,
  insertOutboxEvent,
  type Database,
  type ReleaseStatus,
} from "@deutsch-mate/database";
import { createUuidV7 } from "@deutsch-mate/domain";
import { sql, type Kysely, type Transaction } from "kysely";

import type { RequestActor } from "../../platform/auth/actor.js";
import { KYSELY, type KyselyToken } from "../../platform/database.tokens.js";
import { getRequestStore, requireRequestStore } from "../../platform/request-context.js";

const SHA256_RE = /^[0-9a-f]{64}$/;
const AGGREGATE_TYPE = "curriculum_release" as const;

export type HumanReviewAction =
  | "submitted"
  | "approved"
  | "rejected"
  | "retired"
  | "rollback_selected";

export interface CurriculumReleaseInput {
  readonly releaseKey: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly manifestSha256: string;
}

export interface CurriculumReleaseDto {
  readonly id: string;
  readonly releaseKey: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly manifestSha256: string;
  readonly status: ReleaseStatus;
  readonly approvedAt: string | null;
  readonly publishedAt: string | null;
  readonly retiredAt: string | null;
  readonly createdAt: string;
}

export interface ReviewEventInput {
  readonly action: HumanReviewAction;
  readonly qualification?: string | null;
  readonly validationResult: Record<string, unknown>;
  readonly comment?: string | null;
}

export interface ReviewEventDto {
  readonly id: string;
  readonly aggregateType: typeof AGGREGATE_TYPE;
  readonly aggregateId: string;
  readonly action: string;
  readonly qualification?: string | null;
  readonly validationResult: Record<string, unknown>;
  readonly comment?: string | null;
  readonly occurredAt: string;
  readonly createdAt: string;
}

interface ReleaseRow {
  id: string;
  release_key: string;
  version: number;
  status: ReleaseStatus;
  title: string;
  description: string;
  manifest_sha256: string;
  approved_by: string | null;
  approved_at: Date | null;
  published_by: string | null;
  published_at: Date | null;
  retired_at: Date | null;
  created_by: string;
  created_at: Date;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toReleaseDto(row: ReleaseRow): CurriculumReleaseDto {
  return {
    id: row.id,
    releaseKey: row.release_key,
    version: row.version,
    title: row.title,
    description: row.description,
    manifestSha256: row.manifest_sha256,
    status: row.status,
    approvedAt: toIso(row.approved_at),
    publishedAt: toIso(row.published_at),
    retiredAt: toIso(row.retired_at),
    createdAt: toIso(row.created_at)!,
  };
}

function parseValidationResult(raw: unknown): Record<string, unknown> {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function actorHasRole(actor: RequestActor, role: string): boolean {
  return actor.roles.includes(role as never);
}

function assertContentWrite(actor: RequestActor): void {
  if (actorHasRole(actor, "content_editor") || actorHasRole(actor, "admin")) {
    return;
  }
  throw new ForbiddenException({
    code: "forbidden",
    detail: "content:write requires content_editor (or admin).",
  });
}

function assertContentReview(actor: RequestActor): void {
  if (actorHasRole(actor, "content_reviewer") || actorHasRole(actor, "admin")) {
    return;
  }
  throw new ForbiddenException({
    code: "forbidden",
    detail: "content:review requires content_reviewer (or admin).",
  });
}

@Injectable()
export class ContentService {
  constructor(@Optional() @Inject(KYSELY) private readonly db: KyselyToken | null) {}

  private requireDb(): Kysely<Database> {
    if (!this.db) {
      throw new Error("ContentService requires DATABASE_URL.");
    }
    return this.db;
  }

  private trxOrDb(): Kysely<Database> | Transaction<Database> {
    const store = getRequestStore();
    if (store?.trx) {
      return store.trx;
    }
    return this.requireDb();
  }

  private correlationId(): string {
    return requireRequestStore().requestId;
  }

  /**
   * Registers an already-imported draft release (idempotent on key+version+hash).
   */
  async createRelease(
    actor: RequestActor,
    input: CurriculumReleaseInput,
  ): Promise<CurriculumReleaseDto> {
    assertContentWrite(actor);
    if (!SHA256_RE.test(input.manifestSha256)) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "manifestSha256 must be a 64-char lowercase hex digest.",
      });
    }
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "version must be an integer >= 1.",
      });
    }

    const executor = this.trxOrDb();
    const existing = await sql<ReleaseRow>`
      SELECT
        id, release_key, version, status, title, description, manifest_sha256,
        approved_by, approved_at, published_by, published_at, retired_at,
        created_by, created_at
      FROM content.curriculum_releases
      WHERE release_key = ${input.releaseKey} AND version = ${input.version}
    `.execute(executor);

    const found = existing.rows[0];
    if (found) {
      if (found.manifest_sha256 !== input.manifestSha256) {
        throw new ConflictException({
          code: "conflict",
          detail: "Release key/version exists with a different manifestSha256.",
        });
      }
      return toReleaseDto(found);
    }

    const id = createUuidV7();
    const inserted = await sql<ReleaseRow>`
      INSERT INTO content.curriculum_releases (
        id, release_key, version, status, title, description, manifest_sha256, created_by
      ) VALUES (
        ${id}::uuid,
        ${input.releaseKey},
        ${input.version},
        'draft'::content.release_status,
        ${input.title},
        ${input.description},
        ${input.manifestSha256},
        ${actor.userId}::uuid
      )
      RETURNING
        id, release_key, version, status, title, description, manifest_sha256,
        approved_by, approved_at, published_by, published_at, retired_at,
        created_by, created_at
    `.execute(executor);

    const row = inserted.rows[0];
    if (!row) {
      throw new Error("createRelease: insert returned no row.");
    }

    await appendAuditEvent(executor, {
      actorUserId: actor.userId,
      actorType: "staff",
      action: "content.release.create",
      resourceType: "curriculum_release",
      resourceId: row.id,
      outcome: "success",
      correlationId: this.correlationId(),
      metadata: {
        releaseKey: row.release_key,
        version: row.version,
        manifestSha256: row.manifest_sha256,
      },
    });

    return toReleaseDto(row);
  }

  async recordReviewEvent(
    actor: RequestActor,
    releaseId: string,
    input: ReviewEventInput,
  ): Promise<ReviewEventDto> {
    assertContentReview(actor);

    if (input.action === "rollback_selected") {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "Use POST /ops/content/releases/{releaseId}/rollback for rollback_selected.",
      });
    }

    const executor = this.trxOrDb();
    const release = await this.requireRelease(executor, releaseId);

    switch (input.action) {
      case "submitted":
        await this.assertCanSubmit(release);
        break;
      case "approved":
        await this.assertCanApprove(executor, actor, release);
        break;
      case "rejected":
        await this.assertCanReject(release);
        break;
      case "retired":
        await this.assertCanRetireViaReview(release);
        break;
      default:
        throw new BadRequestException({
          code: "validation_failed",
          detail: "Unsupported review action.",
        });
    }

    const event = await this.insertReviewEvent(executor, {
      releaseId,
      action: input.action,
      actorUserId: actor.userId,
      qualification: input.qualification ?? null,
      validationResult: input.validationResult,
      comment: input.comment ?? null,
    });

    if (input.action === "approved") {
      await sql`
        UPDATE content.curriculum_releases
        SET
          status = 'approved'::content.release_status,
          approved_by = ${actor.userId}::uuid,
          approved_at = now()
        WHERE id = ${releaseId}::uuid
          AND status = 'draft'::content.release_status
      `.execute(executor);
    }

    if (input.action === "rejected") {
      // Status stays draft; rejection is recorded in append-only review_events.
    }

    if (input.action === "retired" && release.status === "approved") {
      // Approved-but-unpublished may return to draft via maintenance? Keep approved;
      // retired status requires published→retired path. Record event only for approved.
      // Human "retired" on draft/approved is governance note without status flip when
      // not published. For published, use publish retirement / rollback flows.
    }

    await appendAuditEvent(executor, {
      actorUserId: actor.userId,
      actorType: "staff",
      action: `content.release.review.${input.action}`,
      resourceType: "curriculum_release",
      resourceId: releaseId,
      outcome: "success",
      correlationId: this.correlationId(),
      metadata: { reviewEventId: event.id, action: input.action },
    });

    return event;
  }

  async publishRelease(actor: RequestActor, releaseId: string): Promise<CurriculumReleaseDto> {
    assertContentReview(actor);
    const executor = this.trxOrDb();
    const release = await this.requireRelease(executor, releaseId);

    if (release.status === "published") {
      return toReleaseDto(release);
    }
    if (release.status !== "approved") {
      throw new ConflictException({
        code: "conflict",
        detail: `Release status '${release.status}' cannot be published; must be approved.`,
      });
    }

    await this.assertIndependentApproval(executor, release);

    const rechecked = await this.requireRelease(executor, releaseId);
    if (rechecked.manifest_sha256 !== release.manifest_sha256) {
      throw new UnprocessableEntityException({
        code: "publication_validation_failed",
        detail: "manifest_sha256 changed since approval; refusing publication.",
      });
    }

    await this.assertPublicationInventory(executor, releaseId, rechecked.manifest_sha256);

    const now = new Date();
    const previous = await sql<ReleaseRow>`
      SELECT
        id, release_key, version, status, title, description, manifest_sha256,
        approved_by, approved_at, published_by, published_at, retired_at,
        created_by, created_at
      FROM content.curriculum_releases
      WHERE status = 'published'::content.release_status
      FOR UPDATE
    `.execute(executor);

    for (const prior of previous.rows) {
      if (prior.id === releaseId) {
        continue;
      }
      await sql`
        UPDATE content.curriculum_releases
        SET
          status = 'retired'::content.release_status,
          retired_at = ${now.toISOString()}::timestamptz
        WHERE id = ${prior.id}::uuid
          AND status = 'published'::content.release_status
      `.execute(executor);

      await this.insertReviewEvent(executor, {
        releaseId: prior.id,
        action: "retired",
        actorUserId: actor.userId,
        qualification: null,
        validationResult: { reason: "superseded_by_publish", successorReleaseId: releaseId },
        comment: null,
      });
    }

    const published = await sql<ReleaseRow>`
      UPDATE content.curriculum_releases
      SET
        status = 'published'::content.release_status,
        published_by = ${actor.userId}::uuid,
        published_at = ${now.toISOString()}::timestamptz
      WHERE id = ${releaseId}::uuid
        AND status = 'approved'::content.release_status
        AND manifest_sha256 = ${rechecked.manifest_sha256}
      RETURNING
        id, release_key, version, status, title, description, manifest_sha256,
        approved_by, approved_at, published_by, published_at, retired_at,
        created_by, created_at
    `.execute(executor);

    const row = published.rows[0];
    if (!row) {
      throw new ConflictException({
        code: "conflict",
        detail: "Publication raced or release is no longer approved with matching manifest.",
      });
    }

    const publishedEvent = await this.insertReviewEvent(executor, {
      releaseId,
      action: "published",
      actorUserId: actor.userId,
      qualification: null,
      validationResult: {
        manifestSha256: row.manifest_sha256,
        inventory: "ok",
      },
      comment: null,
    });

    await appendAuditEvent(executor, {
      actorUserId: actor.userId,
      actorType: "staff",
      action: "content.release.publish",
      resourceType: "curriculum_release",
      resourceId: releaseId,
      outcome: "success",
      correlationId: this.correlationId(),
      metadata: {
        manifestSha256: row.manifest_sha256,
        reviewEventId: publishedEvent.id,
      },
    });

    await insertOutboxEvent(executor, {
      id: createUuidV7(),
      aggregateType: AGGREGATE_TYPE,
      aggregateId: releaseId,
      eventType: "content.curriculum_release.published.v1",
      eventVersion: 1,
      payload: {
        releaseId: row.id,
        releaseKey: row.release_key,
        version: row.version,
        manifestSha256: row.manifest_sha256,
        status: row.status,
      },
      correlationId: this.correlationId(),
      occurredAt: now,
    });

    return toReleaseDto(row);
  }

  /**
   * Selects a previously published (now retired) or approved release as current
   * without rewriting immutable content version rows.
   */
  async rollbackRelease(actor: RequestActor, releaseId: string): Promise<CurriculumReleaseDto> {
    assertContentReview(actor);
    const executor = this.trxOrDb();
    const target = await this.requireRelease(executor, releaseId);

    if (target.status === "published") {
      return toReleaseDto(target);
    }

    if (target.status !== "retired" && target.status !== "approved") {
      throw new ConflictException({
        code: "conflict",
        detail: "Rollback target must be a previously published (retired) or approved release.",
      });
    }

    if (target.approved_by === null || target.approved_at === null) {
      throw new ConflictException({
        code: "conflict",
        detail: "Rollback target lacks an independent approval record.",
      });
    }

    await this.assertPublicationInventory(executor, releaseId, target.manifest_sha256);

    const now = new Date();
    const current = await sql<ReleaseRow>`
      SELECT
        id, release_key, version, status, title, description, manifest_sha256,
        approved_by, approved_at, published_by, published_at, retired_at,
        created_by, created_at
      FROM content.curriculum_releases
      WHERE status = 'published'::content.release_status
      FOR UPDATE
    `.execute(executor);

    for (const prior of current.rows) {
      if (prior.id === releaseId) {
        continue;
      }
      await sql`
        UPDATE content.curriculum_releases
        SET
          status = 'retired'::content.release_status,
          retired_at = ${now.toISOString()}::timestamptz
        WHERE id = ${prior.id}::uuid
          AND status = 'published'::content.release_status
      `.execute(executor);

      await this.insertReviewEvent(executor, {
        releaseId: prior.id,
        action: "retired",
        actorUserId: actor.userId,
        qualification: null,
        validationResult: { reason: "superseded_by_rollback", successorReleaseId: releaseId },
        comment: null,
      });
    }

    const restored = await sql<ReleaseRow>`
      UPDATE content.curriculum_releases
      SET
        status = 'published'::content.release_status,
        retired_at = NULL,
        published_by = ${actor.userId}::uuid,
        published_at = ${now.toISOString()}::timestamptz
      WHERE id = ${releaseId}::uuid
        AND status IN ('retired'::content.release_status, 'approved'::content.release_status)
        AND manifest_sha256 = ${target.manifest_sha256}
      RETURNING
        id, release_key, version, status, title, description, manifest_sha256,
        approved_by, approved_at, published_by, published_at, retired_at,
        created_by, created_at
    `.execute(executor);

    const row = restored.rows[0];
    if (!row) {
      throw new ConflictException({
        code: "conflict",
        detail: "Rollback selection raced or target is no longer selectable.",
      });
    }

    const rollbackEvent = await this.insertReviewEvent(executor, {
      releaseId,
      action: "rollback_selected",
      actorUserId: actor.userId,
      qualification: null,
      validationResult: { manifestSha256: row.manifest_sha256 },
      comment: null,
    });

    await this.insertReviewEvent(executor, {
      releaseId,
      action: "published",
      actorUserId: actor.userId,
      qualification: null,
      validationResult: { reason: "rollback_selected", manifestSha256: row.manifest_sha256 },
      comment: null,
    });

    await appendAuditEvent(executor, {
      actorUserId: actor.userId,
      actorType: "staff",
      action: "content.release.rollback",
      resourceType: "curriculum_release",
      resourceId: releaseId,
      outcome: "success",
      correlationId: this.correlationId(),
      metadata: {
        reviewEventId: rollbackEvent.id,
        manifestSha256: row.manifest_sha256,
      },
    });

    await insertOutboxEvent(executor, {
      id: createUuidV7(),
      aggregateType: AGGREGATE_TYPE,
      aggregateId: releaseId,
      eventType: "content.curriculum_release.rollback_selected.v1",
      eventVersion: 1,
      payload: {
        releaseId: row.id,
        releaseKey: row.release_key,
        version: row.version,
        manifestSha256: row.manifest_sha256,
        status: row.status,
      },
      correlationId: this.correlationId(),
      occurredAt: now,
    });

    return toReleaseDto(row);
  }

  private async requireRelease(
    executor: Kysely<Database> | Transaction<Database>,
    releaseId: string,
  ): Promise<ReleaseRow> {
    const rows = await sql<ReleaseRow>`
      SELECT
        id, release_key, version, status, title, description, manifest_sha256,
        approved_by, approved_at, published_by, published_at, retired_at,
        created_by, created_at
      FROM content.curriculum_releases
      WHERE id = ${releaseId}::uuid
      FOR UPDATE
    `.execute(executor);
    const row = rows.rows[0];
    if (!row) {
      throw new NotFoundException({
        code: "not_found",
        detail: "Curriculum release was not found.",
      });
    }
    return row;
  }

  private async assertCanSubmit(release: ReleaseRow): Promise<void> {
    if (release.status !== "draft") {
      throw new ConflictException({
        code: "conflict",
        detail: `Cannot submit release in status '${release.status}'.`,
      });
    }
  }

  private async assertCanApprove(
    executor: Kysely<Database> | Transaction<Database>,
    actor: RequestActor,
    release: ReleaseRow,
  ): Promise<void> {
    if (release.status !== "draft") {
      throw new ConflictException({
        code: "conflict",
        detail: `Cannot approve release in status '${release.status}'.`,
      });
    }

    if (release.created_by === actor.userId) {
      throw new ForbiddenException({
        code: "forbidden",
        detail: "Release creator cannot self-approve.",
      });
    }

    const submitters = await sql<{ actor_user_id: string }>`
      SELECT actor_user_id
      FROM content.review_events
      WHERE aggregate_type = ${AGGREGATE_TYPE}
        AND aggregate_id = ${release.id}::uuid
        AND action = 'submitted'
    `.execute(executor);

    if (submitters.rows.some((row) => row.actor_user_id === actor.userId)) {
      throw new ForbiddenException({
        code: "forbidden",
        detail: "Release submitter cannot self-approve.",
      });
    }

    // Approver must be an active content_reviewer (admin alone is not an RLS bypass).
    if (!actorHasRole(actor, "content_reviewer") && !actorHasRole(actor, "admin")) {
      throw new ForbiddenException({
        code: "forbidden",
        detail: "Approval requires content_reviewer (or admin).",
      });
    }
  }

  private async assertCanReject(release: ReleaseRow): Promise<void> {
    if (release.status !== "draft") {
      throw new ConflictException({
        code: "conflict",
        detail: `Cannot reject release in status '${release.status}'.`,
      });
    }
  }

  private async assertCanRetireViaReview(release: ReleaseRow): Promise<void> {
    if (release.status === "published") {
      throw new ConflictException({
        code: "conflict",
        detail: "Retire a published release by publishing a successor or via rollback.",
      });
    }
  }

  private async assertIndependentApproval(
    executor: Kysely<Database> | Transaction<Database>,
    release: ReleaseRow,
  ): Promise<void> {
    if (release.approved_by === null || release.approved_at === null) {
      throw new UnprocessableEntityException({
        code: "publication_validation_failed",
        detail: "Publication requires an approved_by / approved_at stamp.",
      });
    }
    if (release.approved_by === release.created_by) {
      throw new UnprocessableEntityException({
        code: "publication_validation_failed",
        detail: "Publication refused: creator self-approval is prohibited.",
      });
    }

    const approved = await sql<{ actor_user_id: string }>`
      SELECT actor_user_id
      FROM content.review_events
      WHERE aggregate_type = ${AGGREGATE_TYPE}
        AND aggregate_id = ${release.id}::uuid
        AND action = 'approved'
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1
    `.execute(executor);

    const approver = approved.rows[0]?.actor_user_id;
    if (!approver) {
      throw new UnprocessableEntityException({
        code: "publication_validation_failed",
        detail: "Publication requires an approved review_event.",
      });
    }
    if (approver === release.created_by) {
      throw new UnprocessableEntityException({
        code: "publication_validation_failed",
        detail: "Publication refused: creator self-approval is prohibited.",
      });
    }
  }

  /**
   * Publication validators: exact stored manifest hash + bounded DB inventory
   * (trust imported package when hash matches; Database.md §7).
   */
  private async assertPublicationInventory(
    executor: Kysely<Database> | Transaction<Database>,
    releaseId: string,
    expectedManifestSha256: string,
  ): Promise<void> {
    const hashCheck = await sql<{ manifest_sha256: string }>`
      SELECT manifest_sha256
      FROM content.curriculum_releases
      WHERE id = ${releaseId}::uuid
    `.execute(executor);
    if (hashCheck.rows[0]?.manifest_sha256 !== expectedManifestSha256) {
      throw new UnprocessableEntityException({
        code: "publication_validation_failed",
        detail: "manifest_sha256 mismatch during publication validation.",
      });
    }

    const modules = await sql<{ module_version_id: string; unit_count: number }>`
      SELECT
        rm.module_version_id,
        (
          SELECT count(*)::int
          FROM content.module_units AS mu
          WHERE mu.module_version_id = rm.module_version_id
        ) AS unit_count
      FROM content.release_modules AS rm
      WHERE rm.release_id = ${releaseId}::uuid
    `.execute(executor);

    if (modules.rows.length === 0) {
      throw new UnprocessableEntityException({
        code: "publication_validation_failed",
        detail: "Release has no linked modules; import a validated package before publish.",
      });
    }

    for (const mod of modules.rows) {
      if (mod.unit_count !== 6) {
        throw new UnprocessableEntityException({
          code: "publication_validation_failed",
          detail: `Module must have exactly 6 units (found ${mod.unit_count}).`,
        });
      }
    }
  }

  private async insertReviewEvent(
    executor: Kysely<Database> | Transaction<Database>,
    input: {
      readonly releaseId: string;
      readonly action: string;
      readonly actorUserId: string;
      readonly qualification: string | null;
      readonly validationResult: Record<string, unknown>;
      readonly comment: string | null;
    },
  ): Promise<ReviewEventDto> {
    const id = createUuidV7();
    const correlationId = this.correlationId();
    const rows = await sql<{
      id: string;
      aggregate_type: string;
      aggregate_id: string;
      action: string;
      qualification: string | null;
      validation_result: unknown;
      comment: string | null;
      occurred_at: Date;
      created_at: Date;
    }>`
      INSERT INTO content.review_events (
        id, aggregate_type, aggregate_id, action, actor_user_id,
        qualification, validation_result, comment, correlation_id
      ) VALUES (
        ${id}::uuid,
        ${AGGREGATE_TYPE},
        ${input.releaseId}::uuid,
        ${input.action},
        ${input.actorUserId}::uuid,
        ${input.qualification},
        ${JSON.stringify(input.validationResult)}::jsonb,
        ${input.comment},
        ${correlationId}::uuid
      )
      RETURNING
        id, aggregate_type, aggregate_id, action, qualification,
        validation_result, comment, occurred_at, created_at
    `.execute(executor);

    const row = rows.rows[0];
    if (!row) {
      throw new Error("insertReviewEvent: insert returned no row.");
    }

    const dto: ReviewEventDto = {
      id: row.id,
      aggregateType: AGGREGATE_TYPE,
      aggregateId: row.aggregate_id,
      action: row.action,
      validationResult: parseValidationResult(row.validation_result),
      occurredAt: toIso(row.occurred_at)!,
      createdAt: toIso(row.created_at)!,
    };
    if (row.qualification !== null) {
      return { ...dto, qualification: row.qualification, comment: row.comment };
    }
    if (row.comment !== null) {
      return { ...dto, comment: row.comment };
    }
    return dto;
  }
}
