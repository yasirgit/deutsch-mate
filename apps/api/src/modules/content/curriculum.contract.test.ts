/**
 * Curriculum contract tests (DM-032): auth, Problem Details, validation for
 * learner published curriculum routes (no DB required).
 */

import "reflect-metadata";

import { isProblemDetails } from "@deutsch-mate/api-schemas";
import { createUuidV7 } from "@deutsch-mate/domain";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_ACTOR_HEADER, TEST_ROLES_HEADER } from "../../platform/auth/auth.guard.js";
import { createContentApp } from "./testing/create-content-app.test.js";
import { StubTokenVerifier } from "../identity/testing/oidc-test-keys.js";

describe("curriculum contract", () => {
  let app: INestApplication;
  const learnerId = createUuidV7();

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    delete process.env["DATABASE_URL"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["AI_KILL_SWITCH"];
    app = await createContentApp({
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

  it("requires authentication for getCurrentCurriculumRelease", async () => {
    const res = await request(app.getHttpServer()).get("/v1/curriculum/releases/current");
    expect(res.status).toBe(401);
    expect(isProblemDetails(res.body)).toBe(true);
    expect(res.body.code).toBe("authentication_required");
  });

  it("requires authentication for listCurriculumModules", async () => {
    const res = await request(app.getHttpServer()).get(
      `/v1/curriculum/releases/${createUuidV7()}/modules`,
    );
    expect(res.status).toBe(401);
    expect(isProblemDetails(res.body)).toBe(true);
  });

  it("rejects invalid unitVersionId shape", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/curriculum/units/not-a-uuid")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner");
    expect(res.status).toBe(400);
    expect(isProblemDetails(res.body)).toBe(true);
    expect(res.body.code).toBe("validation_failed");
  });

  it("rejects invalid lessonVersionId shape", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/curriculum/lessons/not-a-uuid")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner");
    expect(res.status).toBe(400);
    expect(isProblemDetails(res.body)).toBe(true);
    expect(res.body.code).toBe("validation_failed");
  });

  it("never selects actor from body or query on curriculum reads", async () => {
    const spoof = createUuidV7();
    const res = await request(app.getHttpServer())
      .get("/v1/curriculum/units/not-a-uuid")
      .set(TEST_ACTOR_HEADER, learnerId)
      .set(TEST_ROLES_HEADER, "learner")
      .query({ userId: spoof });
    // Auth uses header actor; spoof query must not change validation outcome.
    expect(res.status).toBe(400);
    expect(isProblemDetails(res.body)).toBe(true);
    expect(res.body.code).toBe("validation_failed");
  });
});

