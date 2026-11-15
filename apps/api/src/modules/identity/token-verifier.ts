/**
 * Injectable OIDC access-token verification (DM-035; ADR-013).
 * Prefer injecting a test double so suites never hit the network.
 */

export const TOKEN_VERIFIER = Symbol("TOKEN_VERIFIER");

/** Claims extracted after issuer/audience/signature/exp/alg checks. */
export interface VerifiedOidcClaims {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

export interface TokenVerifier {
  verifyAccessToken(token: string): Promise<VerifiedOidcClaims>;
}

export const OIDC_CONFIG = Symbol("OIDC_CONFIG");

export interface OidcConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
}
