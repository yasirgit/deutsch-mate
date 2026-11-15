/**
 * Onboarding/profile contract tests (DM-037): auth gates and Idempotency-Key.
 */

import "reflect-metadata";

import { isProblemDetails } from "@deutsch-mate/api-schemas";
import { createUuidV7 } from "@deutsch-mate/domain";
import type { INestApplication } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_ACTOR_HEADER } from "../../platform/auth/auth.guard.js";
import { createValidationPipe } from "../../platform/validation.pipe.js";
import {
  assertLocaleProfileSeparation,
  firstSessionClientFixture,
} from "./client-fixtures.js";
import { ProfileInputDto } from "./profile.controller.js";
import { createLearnerApp } from "./testing/create-learner-app.test.js";
import { StubTokenVerifier } from "../identity/testing/oidc-test-keys.js";

describe("onboarding contract", () => {
  let app: INestApplication;
  const actorId = createUuidV7();

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    delete process.env["DATABASE_URL"];
    app = await createLearnerApp({
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

  it("requires authentication for profile and onboarding routes", async () => {
    const profile = await request(app.getHttpServer()).get("/v1/me/profile").expect(401);
    expect(isProblemDetails(profile.body)).toBe(true);
    expect(profile.body.code).toBe("authentication_required");

    const onboarding = await request(app.getHttpServer()).get("/v1/me/onboarding").expect(401);
    expect(onboarding.body.code).toBe("authentication_required");
  });

  it("rejects PUT profile and PATCH onboarding without Idempotency-Key", async () => {
    const profile = await request(app.getHttpServer())
      .put("/v1/me/profile")
      .set(TEST_ACTOR_HEADER, actorId)
      .send(firstSessionClientFixture.profileInput);
    expect(profile.status).toBeGreaterThanOrEqual(400);
    expect(isProblemDetails(profile.body)).toBe(true);

    const onboarding = await request(app.getHttpServer())
      .patch("/v1/me/onboarding")
      .set(TEST_ACTOR_HEADER, actorId)
      .set("Content-Type", "application/merge-patch+json")
      .send({ stepCode: "level" });
    expect(onboarding.status).toBeGreaterThanOrEqual(400);
    expect(isProblemDetails(onboarding.body)).toBe(true);
  });

  it("rejects complete without Idempotency-Key", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/me/onboarding/complete")
      .set(TEST_ACTOR_HEADER, actorId);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(isProblemDetails(res.body)).toBe(true);
  });

  it("rejects unknown ProfileInput fields and keeps locale off profile", async () => {
    assertLocaleProfileSeparation(
      firstSessionClientFixture.localePatch,
      firstSessionClientFixture.profileInput,
    );

    const pipe = createValidationPipe();
    try {
      await pipe.transform(
        { ...firstSessionClientFixture.profileInput, interfaceLocale: "de" },
        { type: "body", metatype: ProfileInputDto },
      );
      expect.unreachable("interfaceLocale must not be accepted on profile");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse();
      expect(body).toMatchObject({ code: "validation_failed" });
    }
  });
});
