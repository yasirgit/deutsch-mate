/**
 * Authentication guard (ADR-013; DM-035).
 *
 * - Bearer token: verify OIDC (when TokenVerifier is registered) → resolve or
 *   provision product user → load active roles → set RequestActor.
 * - development / test ONLY: accepts `X-DM-Test-Actor: <uuid>` (optional
 *   `X-DM-Test-Roles`) when NODE_ENV ≠ production.
 *
 * Account-state: blocked / deleted / deletion_pending → 403 account_access_denied.
 * The acting user is NEVER taken from body, path, or query parameters.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ModuleRef, Reflector } from "@nestjs/core";
import { APP_ROLE_CODES, type AppRoleCode } from "@deutsch-mate/database";

import { IdentityService } from "../../modules/identity/identity.service.js";
import { TOKEN_VERIFIER, type TokenVerifier } from "../../modules/identity/token-verifier.js";
import { requireRequestStore } from "../request-context.js";
import type { RequestActor } from "./actor.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

/** Local/test-only actor override. Never honored when NODE_ENV=production. */
export const TEST_ACTOR_HEADER = "x-dm-test-actor";
export const TEST_ROLES_HEADER = "x-dm-test-roles";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ROLE_SET = new Set<string>(APP_ROLE_CODES);

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  const raw = headers?.[name];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

function parseTestRoles(raw: string | undefined): readonly AppRoleCode[] {
  if (raw === undefined || raw.trim() === "") {
    return ["learner"];
  }
  const roles: AppRoleCode[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const role = part.trim();
    if (!ROLE_SET.has(role) || seen.has(role)) {
      continue;
    }
    seen.add(role);
    roles.push(role as AppRoleCode);
  }
  return roles.length > 0 ? roles : ["learner"];
}

function resolveTestActor(
  headers: Record<string, string | string[] | undefined> | undefined,
): RequestActor | null {
  const nodeEnv = process.env["NODE_ENV"] ?? "development";
  if (nodeEnv === "production") {
    return null;
  }
  const userId = headerValue(headers, TEST_ACTOR_HEADER);
  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    return null;
  }
  return {
    userId,
    roles: parseTestRoles(headerValue(headers, TEST_ROLES_HEADER)),
  };
}

function extractBearer(
  headers: Record<string, string | string[] | undefined> | undefined,
): string | null {
  const authorization = headerValue(headers, "authorization");
  if (typeof authorization !== "string") {
    return null;
  }
  const match = /^Bearer\s+(\S+)/i.exec(authorization);
  return match?.[1] ?? null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
  ) {}

  private resolveIdentity(): IdentityService | null {
    try {
      return this.moduleRef.get(IdentityService, { strict: false });
    } catch {
      return null;
    }
  }

  private resolveTokenVerifier(): TokenVerifier | null {
    try {
      const verifier = this.moduleRef.get<TokenVerifier | null>(TOKEN_VERIFIER, {
        strict: false,
      });
      return verifier ?? null;
    } catch {
      return null;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const store = requireRequestStore();

    const testActor = resolveTestActor(request.headers);
    if (testActor) {
      store.actor = testActor;
      return true;
    }

    const bearer = extractBearer(request.headers);
    if (bearer) {
      const tokenVerifier = this.resolveTokenVerifier();
      const identity = this.resolveIdentity();
      if (!tokenVerifier || !identity) {
        throw new UnauthorizedException({
          code: "authentication_required",
          detail:
            "OIDC token verification is not configured. " +
            "In local/test use X-DM-Test-Actor or register IdentityModule with a TokenVerifier.",
        });
      }

      const claims = await tokenVerifier.verifyAccessToken(bearer);
      try {
        store.actor = await identity.resolveActorFromOidc(claims);
      } catch (error) {
        if (error instanceof ForbiddenException || error instanceof UnauthorizedException) {
          throw error;
        }
        throw error;
      }
      return true;
    }

    throw new UnauthorizedException({
      code: "authentication_required",
      detail: "Authentication is required.",
    });
  }
}
