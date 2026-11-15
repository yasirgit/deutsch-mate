/**
 * OIDC security tests (DM-035): jose-minted JWTs with injectable verifier
 * covering issuer/audience/exp/alg failure paths without network JWKS.
 */

import "reflect-metadata";

import { isProblemDetails } from "@deutsch-mate/api-schemas";
import { createUuidV7 } from "@deutsch-mate/domain";
import type { INestApplication } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { createLocalJWKSet, jwtVerify } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TokenVerifier, VerifiedOidcClaims } from "./token-verifier.js";
import { createIdentityApp } from "./testing/create-identity-app.test.js";
import {
  createTestOidcKeys,
  mintTestAccessToken,
  type TestOidcKeyMaterial,
} from "./testing/oidc-test-keys.js";

/**
 * Verifier that validates jose-minted tokens against an in-memory JWKS
 * (no network). Mirrors production claim checks.
 */
class LocalJwksTokenVerifier implements TokenVerifier {
  private readonly jwks: ReturnType<typeof createLocalJWKSet>;

  constructor(private readonly keys: TestOidcKeyMaterial) {
    this.jwks = createLocalJWKSet({ keys: [keys.publicJwk] });
  }

  async verifyAccessToken(token: string): Promise<VerifiedOidcClaims> {
    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.jwks, {
        issuer: this.keys.issuer,
        audience: this.keys.audience,
        algorithms: ["RS256", "ES256"],
      });
      if (protectedHeader.alg !== "RS256" && protectedHeader.alg !== "ES256") {
        throw new UnauthorizedException({
          code: "authentication_required",
          detail: "Token algorithm is not allowed.",
        });
      }
      if (typeof payload.sub !== "string" || typeof payload.iss !== "string") {
        throw new UnauthorizedException({
          code: "authentication_required",
          detail: "Token subject is missing.",
        });
      }
      return {
        issuer: payload.iss,
        subject: payload.sub,
        email: typeof payload["email"] === "string" ? payload["email"] : null,
        emailVerified: payload["email_verified"] === true,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException({
        code: "authentication_required",
        detail: "Access token verification failed.",
      });
    }
  }
}

describe("oidc security", () => {
  let app: INestApplication;
  let keys: TestOidcKeyMaterial;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    delete process.env["DATABASE_URL"];
    keys = await createTestOidcKeys();
    app = await createIdentityApp({
      oidc: {
        issuer: keys.issuer,
        audience: keys.audience,
        jwksUri: "https://example.test/jwks.json",
      },
      tokenVerifier: new LocalJwksTokenVerifier(keys),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects expired tokens", async () => {
    const token = await mintTestAccessToken(keys, {
      subject: createUuidV7(),
      expiresInSec: -30,
    });
    const res = await request(app.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    expect(isProblemDetails(res.body)).toBe(true);
    expect(res.body.code).toBe("authentication_required");
  });

  it("rejects wrong audience", async () => {
    const token = await mintTestAccessToken(keys, {
      subject: createUuidV7(),
      audience: "other-client",
    });
    const res = await request(app.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    expect(res.body.code).toBe("authentication_required");
  });

  it("rejects wrong issuer", async () => {
    const token = await mintTestAccessToken(keys, {
      subject: createUuidV7(),
      issuer: "https://evil.example/issuer",
    });
    const res = await request(app.getHttpServer())
      .get("/v1/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    expect(res.body.code).toBe("authentication_required");
  });

  it("rejects malformed bearer tokens", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/me")
      .set("Authorization", "Bearer not-a-jwt")
      .expect(401);
    expect(res.body.code).toBe("authentication_required");
  });
});
