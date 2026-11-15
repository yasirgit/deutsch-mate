/**
 * Propagates or allocates `X-Request-Id` and seeds request AsyncLocalStorage.
 * Valid client UUIDs are reused; otherwise a UUIDv7 is created (docs/API.md).
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { createUuidV7 } from "@deutsch-mate/domain";
import type { NextFunction, Request, Response } from "express";

import type { RequestActor } from "./auth/actor.js";
import type { Transaction } from "@deutsch-mate/database";
import type { Database } from "@deutsch-mate/database";

export interface RequestStore {
  readonly requestId: string;
  actor: RequestActor | null;
  trx: Transaction<Database> | null;
}

const storage = new AsyncLocalStorage<RequestStore>();

export function getRequestStore(): RequestStore | undefined {
  return storage.getStore();
}

export function requireRequestStore(): RequestStore {
  const store = storage.getStore();
  if (!store) {
    throw new Error("Request context is not available outside an HTTP request.");
  }
  return store;
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Test helper: run a function under a synthetic request store. */
export function runWithRequestStore<T>(store: RequestStore, fn: () => T): T {
  return storage.run(store, fn);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveRequestId(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw === "string" && UUID_RE.test(raw)) {
    return raw;
  }
  return createUuidV7();
}

/**
 * Express middleware. Uses `enterWith` so Nest guards/interceptors inherit
 * the store across async boundaries for this request.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req.headers["x-request-id"]);
  res.setHeader("X-Request-Id", requestId);

  const store: RequestStore = {
    requestId,
    actor: null,
    trx: null,
  };
  storage.enterWith(store);
  next();
}
