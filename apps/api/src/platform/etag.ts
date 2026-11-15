/**
 * Strong ETag helpers for mutable resources keyed by `lockVersion`
 * (docs/API.md; OpenAPI IfMatch / ETag). Mutations never accept lockVersion
 * in the body — clients send If-Match only.
 *
 * Immutable curriculum versions use content-hash ETags and If-None-Match/304.
 */

import { createHash } from "node:crypto";

import { ConflictException, HttpException, HttpStatus } from "@nestjs/common";

/** OpenAPI IfMatch pattern: strong quoted positive integer, e.g. `"3"`. */
export const IF_MATCH_PATTERN = /^"([1-9][0-9]*)"$/;

/** Strong quoted content-hash ETag (64 hex chars). */
export const IMMUTABLE_ETAG_PATTERN = /^"[0-9a-f]{64}"$/;

export function formatLockVersionEtag(lockVersion: number): string {
  if (!Number.isInteger(lockVersion) || lockVersion < 1) {
    throw new Error("lockVersion must be an integer >= 1.");
  }
  return `"${lockVersion}"`;
}

/** Content-based strong ETag for immutable published curriculum resources. */
export function formatImmutableContentEtag(material: string): string {
  const digest = createHash("sha256").update(material, "utf8").digest("hex");
  return `"${digest}"`;
}

/** True when If-None-Match matches the current strong ETag (or is `*`). */
export function matchesIfNoneMatch(
  ifNoneMatch: string | string[] | undefined,
  etag: string,
): boolean {
  const raw = Array.isArray(ifNoneMatch) ? ifNoneMatch[0] : ifNoneMatch;
  if (typeof raw !== "string" || raw.trim() === "") {
    return false;
  }
  const trimmed = raw.trim();
  if (trimmed === "*") {
    return true;
  }
  for (const part of trimmed.split(",")) {
    const candidate = part.trim();
    if (candidate === etag) {
      return true;
    }
  }
  return false;
}

export function parseIfMatchLockVersion(ifMatch: string): number {
  const match = IF_MATCH_PATTERN.exec(ifMatch.trim());
  if (!match || match[1] === undefined) {
    throw new HttpException(
      {
        code: "validation_failed",
        detail: 'If-Match must be a strong ETag like "3".',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return Number(match[1]);
}

/**
 * Asserts If-Match is present and matches the current lockVersion.
 * Missing → 428 precondition_required; stale → 409 etag_mismatch.
 */
export function assertIfMatch(
  currentLockVersion: number,
  ifMatchHeader: string | string[] | undefined,
): void {
  const raw = Array.isArray(ifMatchHeader) ? ifMatchHeader[0] : ifMatchHeader;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new HttpException(
      {
        code: "precondition_required",
        detail: "If-Match header is required for this mutation.",
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  const expected = parseIfMatchLockVersion(raw);
  if (expected !== currentLockVersion) {
    throw new ConflictException({
      code: "etag_mismatch",
      detail: "If-Match does not match the current resource version.",
    });
  }
}
