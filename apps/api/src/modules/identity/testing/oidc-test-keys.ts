/**
 * In-memory TokenVerifier + optional jose RSA minting helpers for identity tests.
 */

import { exportJWK, generateKeyPair, SignJWT, type JWK, type CryptoKey } from "jose";

import type { TokenVerifier, VerifiedOidcClaims } from "../token-verifier.js";

export class StubTokenVerifier implements TokenVerifier {
  constructor(private readonly claimsByToken: Map<string, VerifiedOidcClaims>) {}

  static fromClaims(token: string, claims: VerifiedOidcClaims): StubTokenVerifier {
    return new StubTokenVerifier(new Map([[token, claims]]));
  }

  async verifyAccessToken(token: string): Promise<VerifiedOidcClaims> {
    const claims = this.claimsByToken.get(token);
    if (!claims) {
      const { UnauthorizedException } = await import("@nestjs/common");
      throw new UnauthorizedException({
        code: "authentication_required",
        detail: "Access token verification failed.",
      });
    }
    return claims;
  }
}

export interface TestOidcKeyMaterial {
  readonly issuer: string;
  readonly audience: string;
  readonly privateKey: CryptoKey;
  readonly publicJwk: JWK;
  readonly kid: string;
}

export async function createTestOidcKeys(
  issuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_test",
  audience = "test-app-client",
): Promise<TestOidcKeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const kid = "test-kid-1";
  publicJwk.kid = kid;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  return { issuer, audience, privateKey, publicJwk, kid };
}

export async function mintTestAccessToken(
  keys: TestOidcKeyMaterial,
  claims: {
    readonly subject: string;
    readonly email?: string;
    readonly emailVerified?: boolean;
    readonly expiresInSec?: number;
    readonly audience?: string;
    readonly issuer?: string;
  },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: claims.email,
    email_verified: claims.emailVerified ?? true,
  })
    .setProtectedHeader({ alg: "RS256", kid: keys.kid })
    .setIssuer(claims.issuer ?? keys.issuer)
    .setAudience(claims.audience ?? keys.audience)
    .setSubject(claims.subject)
    .setIssuedAt(now)
    .setExpirationTime(now + (claims.expiresInSec ?? 300))
    .sign(keys.privateKey);
}
