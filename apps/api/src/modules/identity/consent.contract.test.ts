/**
 * Consent contract tests (DM-036): auth gates and input shape without DB.
 */

import "reflect-metadata";

import { isProblemDetails } from "@deutsch-mate/api-schemas";
import { createUuidV7 } from "@deutsch-mate/domain";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_ACTOR_HEADER } from "../../platform/auth/auth.guard.js";
import { createIdentityApp } from "./testing/create-identity-app.test.js";
import { StubTokenVerifier } from "./testing/oidc-test-keys.js";

describe("consent contract", () => {
  let app: INestApplication;
  const actorId = createUuidV7();

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    delete process.env["DATABASE_URL"];
    app = await createIdentityApp({
      tokenVerifier: StubTokenVerifier.fromClaims("unused", {
        issuer: "https://example.test",
        subject: "sub",
        email: null,
        emailVerified: false,
      }),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication for consent routes", async () => {
    const reqs = await request(app.getHttpServer()).get("/v1/me/consents/requirements").expect(401);
    expect(isProblemDetails(reqs.body)).toBe(true);
    expect(reqs.body.code).toBe("authentication_required");

    const list = await request(app.getHttpServer()).get("/v1/me/consents").expect(401);
    expect(list.body.code).toBe("authentication_required");
  });

  it("rejects POST consents without Idempotency-Key", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/me/consents")
      .set(TEST_ACTOR_HEADER, actorId)
      .send({
        events: [{ purposeCode: "marketing", decision: "granted", source: "web" }],
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(isProblemDetails(res.body)).toBe(true);
  });
});
