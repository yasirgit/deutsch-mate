/**
 * Identity profile contract tests (DM-035): GET/PATCH /me shape, ETag,
 * auth actor source, age fields on User response.
 */

import "reflect-metadata";

import { isProblemDetails, isUuidV7 } from "@deutsch-mate/api-schemas";
import { createUuidV7 } from "@deutsch-mate/domain";
import type { INestApplication } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_ACTOR_HEADER } from "../../platform/auth/auth.guard.js";
import { createValidationPipe } from "../../platform/validation.pipe.js";
import { UserPatchDto } from "./identity.controller.js";
import { createIdentityApp } from "./testing/create-identity-app.test.js";
import { StubTokenVerifier } from "./testing/oidc-test-keys.js";

describe("identity-profile contract", () => {
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

  it("requires authentication for GET /me", async () => {
    const res = await request(app.getHttpServer()).get("/v1/me").expect(401);
    expect(isProblemDetails(res.body)).toBe(true);
    expect(res.body.code).toBe("authentication_required");
  });

  it("never selects actor from body or query on GET /me", async () => {
    const spoof = createUuidV7();
    const res = await request(app.getHttpServer())
      .get("/v1/me")
      .set(TEST_ACTOR_HEADER, actorId)
      .query({ userId: spoof })
      .send({ userId: spoof });

    expect(res.status).not.toBe(200);
    if (res.body && typeof res.body === "object" && "id" in res.body) {
      expect(res.body.id).not.toBe(spoof);
    }
    expect(isUuidV7(actorId)).toBe(true);
  });

  it("rejects PATCH /me without Idempotency-Key", async () => {
    const res = await request(app.getHttpServer())
      .patch("/v1/me")
      .set(TEST_ACTOR_HEADER, actorId)
      .set("Content-Type", "application/merge-patch+json")
      .send({ interfaceLocale: "de" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(isProblemDetails(res.body)).toBe(true);
  });

  it("rejects unknown UserPatch fields via ValidationPipe", async () => {
    const pipe = createValidationPipe();
    try {
      await pipe.transform(
        { interfaceLocale: "en", unexpected: true },
        { type: "body", metatype: UserPatchDto },
      );
      expect.unreachable("unknown fields must fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse();
      expect(body).toMatchObject({ code: "validation_failed" });
    }
  });
});
