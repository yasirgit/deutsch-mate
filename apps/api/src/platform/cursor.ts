/**
 * Opaque cursor pagination helpers (docs/API.md).
 * Clients must not decode cursors; encoding is an implementation detail.
 */

import { BadRequestException } from "@nestjs/common";

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export interface PageParams {
  readonly limit: number;
  readonly cursor: string | null;
}

export interface CursorPayload {
  readonly v: 1;
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Encodes a stable cursor payload as opaque base64url. */
export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

/** Decodes an opaque cursor; invalid values map to validation_failed. */
export function decodeCursor(cursor: string): CursorPayload {
  if (cursor.length === 0 || cursor.length > 2048) {
    throw new BadRequestException({
      code: "validation_failed",
      detail: "cursor is invalid.",
    });
  }
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed) || parsed["v"] !== 1) {
      throw new Error("bad cursor shape");
    }
    return parsed as CursorPayload;
  } catch {
    throw new BadRequestException({
      code: "validation_failed",
      detail: "cursor is invalid.",
    });
  }
}

export function parsePageParams(query: {
  readonly limit?: string | number;
  readonly cursor?: string;
}): PageParams {
  let limit = DEFAULT_PAGE_LIMIT;
  if (query.limit !== undefined && query.limit !== "") {
    const n = typeof query.limit === "number" ? query.limit : Number(query.limit);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_LIMIT) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}.`,
      });
    }
    limit = n;
  }
  const cursor = typeof query.cursor === "string" && query.cursor.length > 0 ? query.cursor : null;
  if (cursor !== null) {
    decodeCursor(cursor);
  }
  return { limit, cursor };
}

export function buildPageResponse<T>(
  items: readonly T[],
  nextCursor: string | null,
): {
  readonly items: readonly T[];
  readonly page: { readonly nextCursor: string | null };
} {
  return { items, page: { nextCursor } };
}
