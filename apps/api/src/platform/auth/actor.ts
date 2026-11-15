/**
 * Authenticated product actor. Resolved from verified identity context only
 * (OIDC in production — DM-035; test header in local/test — see AuthGuard).
 * Request body, path, or query MUST NEVER select the acting user.
 */

import type { AppRoleCode } from "@deutsch-mate/database";

export interface RequestActor {
  readonly userId: string;
  readonly roles: readonly AppRoleCode[];
}
