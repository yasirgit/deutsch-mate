/**
 * Learning contract tests (DM-038): auth gates and Idempotency-Key.
 */

import "reflect-metadata";

import { isProblemDetails } from "@deutsch-mate/api-schemas";
import { createUuidV7 } from "@deutsch-mate/domain";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_ACTOR_HEADER } from "../../platform/auth/auth.guard.js";
import { StubTokenVerifier } from "../identity/testing/oidc-test-keys.js";
import { createLearningApp } from "./testing/create-learning-app.test.js";

describe("learning contract", () => {
  let app: INestApplication;
  const actorId = createUuidV7();

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    delete process.env["DATABASE_URL"];
    app = await createLearningApp({
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

  it("requires authentication for session and attempt routes", async () => {
    const list = await request(app.getHttpServer()).get("/v1/learning/sessions").expect(401);
    expect(isProblemDetails(list.body)).toBe(true);
    expect(list.body.code).toBe("authentication_required");

    const get = await request(app.getHttpServer())
      .get(`/v1/learning/sessions/${createUuidV7()}`)
      .expect(401);
    expect(get.body.code).toBe("authentication_required");

    const attempt = await request(app.getHttpServer())
      .get(`/v1/learning/attempts/${createUuidV7()}`)
      .expect(401);
    expect(attempt.body.code).toBe("authentication_required");
  });

  it("rejects create session and submit attempt without Idempotency-Key", async () => {
    const create = await request(app.getHttpServer())
      .post("/v1/learning/sessions")
      .set(TEST_ACTOR_HEADER, actorId)
      .send({
        curriculumReleaseId: createUuidV7(),
        unitVersionId: createUuidV7(),
        clientPlatform: "web",
      });
    expect(create.status).toBeGreaterThanOrEqual(400);
    expect(isProblemDetails(create.body)).toBe(true);

    const submit = await request(app.getHttpServer())
      .post(`/v1/learning/sessions/${createUuidV7()}/attempts`)
      .set(TEST_ACTOR_HEADER, actorId)
      .send({
        activityVersionId: createUuidV7(),
        clientAttemptId: createUuidV7(),
        attemptNumber: 1,
        response: { responseKind: "choice", response: { selected: ["a"] } },
      });
    expect(submit.status).toBeGreaterThanOrEqual(400);
    expect(isProblemDetails(submit.body)).toBe(true);
  });

  it("rejects unknown fields on LearningSessionInput", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/learning/sessions")
      .set(TEST_ACTOR_HEADER, actorId)
      .set("Idempotency-Key", createUuidV7())
      .send({
        curriculumReleaseId: createUuidV7(),
        unitVersionId: createUuidV7(),
        clientPlatform: "web",
        unexpected: true,
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(isProblemDetails(res.body)).toBe(true);
  });
});
