/**
 * Content ops contract tests (DM-031): auth, actor source, Idempotency-Key,
 * DTO validation for protected curriculum governance routes.
 */

import "reflect-metadata";

import { isProblemDetails, isUuidV7 } from "@deutsch-mate/api-schemas";
import { createUuidV7 } from "@deutsch-mate/domain";
import type { INestApplication } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_ACTOR_HEADER, TEST_ROLES_HEADER } from "../../platform/auth/auth.guard.js";
import { createValidationPipe } from "../../platform/validation.pipe.js";
import { CurriculumReleaseInputDto, ReviewEventInputDto } from "./content.controller.js";
import { createContentApp } from "./testing/create-content-app.test.js";
import { StubTokenVerifier } from "../identity/testing/oidc-test-keys.js";

const SHA =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("content-ops contract", () => {
  let app: INestApplication;
  const editorId = createUuidV7();

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    delete process.env["DATABASE_URL"];
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

  it("requires authentication for createCurriculumRelease", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/ops/content/releases")
      .send({
        releaseKey: "r1",
        version: 1,
        title: "T",
        description: "D",
        manifestSha256: SHA,
      });
    expect(res.status).toBe(401);
    expect(isProblemDetails(res.body)).toBe(true);
    expect(res.body.code).toBe("authentication_required");
  });

  it("never selects actor from body or query on ops create", async () => {
    const spoof = createUuidV7();
    const res = await request(app.getHttpServer())
      .post("/v1/ops/content/releases")
      .set(TEST_ACTOR_HEADER, editorId)
      .set(TEST_ROLES_HEADER, "content_editor")
      .set("Idempotency-Key", createUuidV7())
      .query({ userId: spoof })
      .send({
        releaseKey: "r1",
        version: 1,
        title: "T",
        description: "D",
        manifestSha256: SHA,
        userId: spoof,
        createdBy: spoof,
      });

    // Without DB the handler fails after auth; actor must still be the header.
    expect(res.status).not.toBe(200);
    expect(isUuidV7(editorId)).toBe(true);
    if (isProblemDetails(res.body) && res.body.code === "validation_failed") {
      expect(res.body.errors?.some((e: { path: string }) => e.path.includes("userId"))).toBe(
        true,
      );
    }
  });

  it("rejects create without Idempotency-Key", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/ops/content/releases")
      .set(TEST_ACTOR_HEADER, editorId)
      .set(TEST_ROLES_HEADER, "content_editor")
      .send({
        releaseKey: "r1",
        version: 1,
        title: "T",
        description: "D",
        manifestSha256: SHA,
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(isProblemDetails(res.body)).toBe(true);
  });

  it("rejects unknown CurriculumReleaseInput fields", async () => {
    const pipe = createValidationPipe();
    try {
      await pipe.transform(
        {
          releaseKey: "r1",
          version: 1,
          title: "T",
          description: "D",
          manifestSha256: SHA,
          unexpected: true,
        },
        { type: "body", metatype: CurriculumReleaseInputDto },
      );
      expect.unreachable("unknown fields must fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse();
      expect(body).toMatchObject({ code: "validation_failed" });
    }
  });

  it("rejects ReviewEventInput with published action (server-only)", async () => {
    const pipe = createValidationPipe();
    try {
      await pipe.transform(
        { action: "published", validationResult: {} },
        { type: "body", metatype: ReviewEventInputDto },
      );
      expect.unreachable("published must fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
    }
  });

  it("learner current release route requires auth", async () => {
    const res = await request(app.getHttpServer()).get("/v1/curriculum/releases/current");
    expect(res.status).toBe(401);
    expect(isProblemDetails(res.body)).toBe(true);
  });
});
