/**
 * jose-backed OIDC access-token verifier.
 * Validates issuer, audience, signature (JWKS), expiry, and alg allowlist.
 */

import { createRemoteJWKSet, jwtVerify, errors as JoseErrors } from "jose";
import { Injectable, UnauthorizedException } from "@nestjs/common";

import type { OidcConfig, TokenVerifier, VerifiedOidcClaims } from "./token-verifier.js";

const ALLOWED_ALGS = new Set(["RS256", "ES256"]);

@Injectable()
export class JoseOidcTokenVerifier implements TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: OidcConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUri));
  }

  async verifyAccessToken(token: string): Promise<VerifiedOidcClaims> {
    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ["RS256", "ES256"],
      });

      const alg = protectedHeader.alg;
      if (typeof alg !== "string" || !ALLOWED_ALGS.has(alg)) {
        throw new UnauthorizedException({
          code: "authentication_required",
          detail: "Token algorithm is not allowed.",
        });
      }

      const subject = payload.sub;
      if (typeof subject !== "string" || subject.length === 0) {
        throw new UnauthorizedException({
          code: "authentication_required",
          detail: "Token subject is missing.",
        });
      }

      const issuer = payload.iss;
      if (typeof issuer !== "string" || issuer !== this.config.issuer) {
        throw new UnauthorizedException({
          code: "authentication_required",
          detail: "Token issuer is invalid.",
        });
      }

      const email = typeof payload["email"] === "string" ? payload["email"] : null;
      const emailVerified = payload["email_verified"] === true;

      return {
        issuer,
        subject,
        email,
        emailVerified,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      if (
        error instanceof JoseErrors.JWTExpired ||
        error instanceof JoseErrors.JWTClaimValidationFailed ||
        error instanceof JoseErrors.JWSSignatureVerificationFailed ||
        error instanceof JoseErrors.JWKSNoMatchingKey ||
        error instanceof JoseErrors.JOSEError
      ) {
        throw new UnauthorizedException({
          code: "authentication_required",
          detail: "Access token verification failed.",
        });
      }
      throw new UnauthorizedException({
        code: "authentication_required",
        detail: "Access token verification failed.",
      });
    }
  }
}

export function deriveJwksUri(issuer: string, explicit?: string): string {
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  return `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
}
