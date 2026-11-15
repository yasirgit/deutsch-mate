/**
 * Identity capability module (DM-035): OIDC verification, user lifecycle, /me.
 */

import { Global, Module, type DynamicModule, type Provider } from "@nestjs/common";

import { IdentityController } from "./identity.controller.js";
import { ConsentController } from "./consent.controller.js";
import { ConsentService } from "./consent.service.js";
import { IdentityService } from "./identity.service.js";
import { deriveJwksUri, JoseOidcTokenVerifier } from "./jose-oidc-token-verifier.js";
import {
  OIDC_CONFIG,
  TOKEN_VERIFIER,
  type OidcConfig,
  type TokenVerifier,
} from "./token-verifier.js";

export interface IdentityModuleOptions {
  readonly oidc?: OidcConfig;
  /** Inject a test verifier (no network). When set, oidc JWKS is unused. */
  readonly tokenVerifier?: TokenVerifier;
}

function resolveOidcFromEnv(): OidcConfig | null {
  const issuer = process.env["OIDC_ISSUER"];
  const audience = process.env["OIDC_AUDIENCE"];
  if (typeof issuer !== "string" || issuer.length === 0) {
    return null;
  }
  if (typeof audience !== "string" || audience.length === 0) {
    return null;
  }
  return {
    issuer,
    audience,
    jwksUri: deriveJwksUri(issuer, process.env["OIDC_JWKS_URI"]),
  };
}

@Global()
@Module({})
export class IdentityModule {
  static register(options: IdentityModuleOptions = {}): DynamicModule {
    const oidc = options.oidc ?? resolveOidcFromEnv();
    const providers: Provider[] = [IdentityService, ConsentService];

    if (options.tokenVerifier) {
      providers.push({ provide: TOKEN_VERIFIER, useValue: options.tokenVerifier });
      if (oidc) {
        providers.push({ provide: OIDC_CONFIG, useValue: oidc });
      }
    } else if (oidc) {
      providers.push({ provide: OIDC_CONFIG, useValue: oidc });
      providers.push({
        provide: TOKEN_VERIFIER,
        useFactory: (config: OidcConfig): TokenVerifier => new JoseOidcTokenVerifier(config),
        inject: [OIDC_CONFIG],
      });
    } else {
      providers.push({ provide: TOKEN_VERIFIER, useValue: null });
    }

    return {
      module: IdentityModule,
      controllers: [IdentityController, ConsentController],
      providers,
      exports: [IdentityService, ConsentService, TOKEN_VERIFIER],
    };
  }
}

export { IdentityService, isAdultBirthYear, MINIMUM_ADULT_AGE } from "./identity.service.js";
export type { UserResponse, AccountStatus } from "./identity.service.js";
export { ConsentService } from "./consent.service.js";
export { seedLegalDocumentVersion } from "./seed-legal-documents.js";
export { TOKEN_VERIFIER, OIDC_CONFIG } from "./token-verifier.js";
export type { TokenVerifier, VerifiedOidcClaims, OidcConfig } from "./token-verifier.js";
export { JoseOidcTokenVerifier, deriveJwksUri } from "./jose-oidc-token-verifier.js";
