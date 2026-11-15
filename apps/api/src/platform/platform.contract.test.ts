/**
 * Platform contract tests (DM-026): request ID, validation, Problem Details,
 * auth actor source, health liveness, rate-limit headers, ETag helpers.
 */

import "reflect-metadata";

import { isProblemDetails, isUuidV7 } from "@deutsch-mate/api-schemas";
import { createUuidV7 } from "@deutsch-mate/domain";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_ACTOR_HEADER } from "./auth/auth.guard.js";
import { encodeCursor, decodeCursor, parsePageParams } from "./cursor.js";
import { assertIfMatch, formatLockVersionEtag, parseIfMatchLockVersion } from "./etag.js";
import { createPlatformApp } from "./testing/create-platform-app.test.js";

describe("api-platform contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    // Intentionally no DATABASE_URL so readiness is deploy-safe 503.
    delete process.env["DATABASE_URL"];
    app = await createPlatformApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns X-Request-Id on every response and propagates client UUID", async () => {
    const clientId = createUuidV7();
    const live = await request(app.getHttpServer())
      .get("/v1/health/live")
      .set("X-Request-Id", clientId)
      .expect(200);

    expect(live.headers["x-request-id"]).toBe(clientId);
    expect(live.body).toMatchObject({ status: "ok" });
    expect(typeof live.body.checkedAt).toBe("string");

    const ready = await request(app.getHttpServer()).get("/v1/health/ready").expect(503);

    expect(typeof ready.headers["x-request-id"]).toBe("string");
    const readyRequestId = String(ready.headers["x-request-id"]);
    expect(isUuidV7(readyRequestId) || UUID_ANY.test(readyRequestId)).toBe(true);
    expect(ready.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(isProblemDetails(ready.body)).toBe(true);
    expect(ready.body.code).toBe("dependency_unavailable");
    expect(ready.body.requestId).toBe(ready.headers["x-request-id"]);
  });

  it("rejects unknown body fields with validation_failed Problem Details", async () => {
    const actor = createUuidV7();
    const res = await request(app.getHttpServer())
      .post("/v1/platform/probes/echo")
      .set(TEST_ACTOR_HEADER, actor)
      .send({ message: "hello", unexpected: true })
      .expect(400);

    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(isProblemDetails(res.body)).toBe(true);
    expect(res.body.code).toBe("validation_failed");
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|SELECT |password/i);
  });

  it("never selects actor from request body", async () => {
    const actor = createUuidV7();
    const spoof = createUuidV7();
    const res = await request(app.getHttpServer())
      .get("/v1/platform/probes/me")
      .set(TEST_ACTOR_HEADER, actor)
      .query({ userId: spoof })
      .expect(200);

    expect(res.body.userId).toBe(actor);
    expect(res.body.userId).not.toBe(spoof);
  });

  it("requires authentication when test actor header is absent", async () => {
    const res = await request(app.getHttpServer()).get("/v1/platform/probes/me").expect(401);

    expect(isProblemDetails(res.body)).toBe(true);
    expect(res.body.code).toBe("authentication_required");
  });

  it("sanitizes unhandled errors and never leaks SQL/secrets", async () => {
    const res = await request(app.getHttpServer()).get("/v1/platform/probes/boom").expect(500);

    expect(isProblemDetails(res.body)).toBe(true);
    expect(res.body.code).toBe("internal_error");
    expect(res.body.detail).toBe("An unexpected error occurred.");
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|password|secrets|stack/i);
  });

  it("sets RateLimit-* stub headers on success", async () => {
    const res = await request(app.getHttpServer()).get("/v1/health/live").expect(200);
    expect(res.headers["ratelimit-limit"]).toBeDefined();
    expect(res.headers["ratelimit-remaining"]).toBeDefined();
    expect(res.headers["ratelimit-reset"]).toBeDefined();
  });

  it("maps stale If-Match to etag_mismatch and missing to 428", async () => {
    const actor = createUuidV7();

    const missing = await request(app.getHttpServer())
      .patch("/v1/platform/probes/resource")
      .set(TEST_ACTOR_HEADER, actor)
      .send({})
      .expect(428);
    expect(missing.body.code).toBe("precondition_required");

    const stale = await request(app.getHttpServer())
      .patch("/v1/platform/probes/resource")
      .set(TEST_ACTOR_HEADER, actor)
      .set("If-Match", '"99"')
      .send({})
      .expect(409);
    expect(stale.body.code).toBe("etag_mismatch");

    const ok = await request(app.getHttpServer())
      .patch("/v1/platform/probes/resource")
      .set(TEST_ACTOR_HEADER, actor)
      .set("If-Match", '"1"')
      .send({})
      .expect(200);
    expect(ok.headers.etag).toBe('"2"');
    expect(ok.body.lockVersion).toBe(2);
  });

  it("provides lockVersion ETag and opaque cursor helpers", () => {
    expect(formatLockVersionEtag(3)).toBe('"3"');
    expect(parseIfMatchLockVersion('"3"')).toBe(3);
    expect(() => assertIfMatch(3, '"2"')).toThrow();

    const cursor = encodeCursor({ v: 1, id: "abc" });
    expect(decodeCursor(cursor)).toEqual({ v: 1, id: "abc" });
    expect(parsePageParams({ limit: "10" }).limit).toBe(10);
    expect(() => parsePageParams({ limit: "999" })).toThrow();
  });
});

const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
