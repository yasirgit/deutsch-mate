/**
 * Identity persistence and product-user lifecycle (DM-035).
 *
 * Provisioning uses ops.resolve_or_provision_user (SECURITY DEFINER, owned by
 * dm_security) because first-login cannot satisfy learner RLS for role grants
 * or identity lookup before app.user_id exists. Ordinary reads/updates use
 * dm_api + app.user_id via the request transaction.
 *
 * Account-state policy: blocked | deleted | deletion_pending → HTTP 403 with
 * code account_access_denied (token verified; product access denied).
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { APP_ROLE_CODES, type AppRoleCode, type Database } from "@deutsch-mate/database";
import { createUuidV7 } from "@deutsch-mate/domain";
import { sql, type Kysely, type Transaction } from "kysely";

import { KYSELY, type KyselyToken } from "../../platform/database.tokens.js";
import type { RequestActor } from "../../platform/auth/actor.js";
import { assertIfMatch } from "../../platform/etag.js";
import { getRequestStore } from "../../platform/request-context.js";
import type { VerifiedOidcClaims } from "./token-verifier.js";

/** Minimum adult age for the year-only birth_year gate. */
export const MINIMUM_ADULT_AGE = 18;

export type AccountStatus = "active" | "deletion_pending" | "deleted" | "blocked";

export interface ProductUserRow {
  readonly id: string;
  readonly status: AccountStatus;
  readonly primaryEmail: string | null;
  readonly interfaceLocale: string;
  readonly countryCode: string | null;
  readonly birthYear: number | null;
  readonly ageGateConfirmedAt: Date | null;
  readonly lockVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly roles: readonly AppRoleCode[];
}

export interface UserResponse {
  readonly id: string;
  readonly status: AccountStatus;
  readonly primaryEmail: string | null;
  readonly interfaceLocale: string;
  readonly countryCode: string | null;
  readonly birthYear: number | null;
  readonly ageGateConfirmedAt: string | null;
  readonly roles: readonly AppRoleCode[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ResolveRow {
  out_user_id: string;
  out_status: AccountStatus;
  out_roles: string[] | null;
}

const ROLE_SET = new Set<string>(APP_ROLE_CODES);

function parseRoles(raw: string[] | null | undefined): AppRoleCode[] {
  if (!raw || raw.length === 0) {
    return [];
  }
  const roles: AppRoleCode[] = [];
  const seen = new Set<string>();
  for (const role of raw) {
    if (!ROLE_SET.has(role) || seen.has(role)) {
      continue;
    }
    seen.add(role);
    roles.push(role as AppRoleCode);
  }
  return roles;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function isAdultBirthYear(birthYear: number, now: Date = new Date()): boolean {
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > 2100) {
    return false;
  }
  return birthYear <= now.getUTCFullYear() - MINIMUM_ADULT_AGE;
}

export function toUserResponse(row: ProductUserRow): UserResponse {
  return {
    id: row.id,
    status: row.status,
    primaryEmail: row.primaryEmail,
    interfaceLocale: row.interfaceLocale,
    countryCode: row.countryCode,
    birthYear: row.birthYear,
    ageGateConfirmedAt:
      row.ageGateConfirmedAt === null ? null : toIso(row.ageGateConfirmedAt),
    roles: row.roles,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function assertProductAccess(status: AccountStatus): void {
  if (status === "active") {
    return;
  }
  // 403: OIDC authentication succeeded; the account must not use the product.
  throw new ForbiddenException({
    code: "account_access_denied",
    detail: `Account status '${status}' denies product access.`,
  });
}

@Injectable()
export class IdentityService {
  constructor(@Optional() @Inject(KYSELY) private readonly db: KyselyToken | null) {}

  private requireDb(): Kysely<Database> {
    if (!this.db) {
      throw new Error("IdentityService requires DATABASE_URL.");
    }
    return this.db;
  }

  private trxOrDb(): Kysely<Database> | Transaction<Database> {
    const store = getRequestStore();
    if (store?.trx) {
      return store.trx;
    }
    return this.requireDb();
  }

  /**
   * Resolve or provision a product user from verified OIDC claims, then return
   * a RequestActor. Uses SECURITY DEFINER provision outside the request txn.
   */
  async resolveActorFromOidc(claims: VerifiedOidcClaims): Promise<RequestActor> {
    const db = this.requireDb();
    const result = await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL ROLE dm_api`.execute(trx);
      const rows = await sql<ResolveRow>`
        SELECT *
        FROM ops.resolve_or_provision_user(
          ${claims.issuer},
          ${claims.subject},
          ${claims.email},
          ${claims.emailVerified},
          ${createUuidV7()}::uuid,
          ${createUuidV7()}::uuid,
          ${createUuidV7()}::uuid,
          ${createUuidV7()}::uuid
        )
      `.execute(trx);

      const row = rows.rows[0];
      if (!row) {
        throw new Error("resolve_or_provision_user returned no row");
      }
      return row;
    });

    assertProductAccess(result.out_status);
    const roles = parseRoles(result.out_roles);
    if (roles.length === 0) {
      throw new ForbiddenException({
        code: "account_access_denied",
        detail: "Account has no active roles.",
      });
    }

    return {
      userId: result.out_user_id,
      roles,
    };
  }

  async getCurrentUser(userId: string): Promise<{ user: UserResponse; lockVersion: number }> {
    const row = await this.loadUser(userId);
    assertProductAccess(row.status);
    return { user: toUserResponse(row), lockVersion: row.lockVersion };
  }

  async updateInterfaceLocale(
    userId: string,
    interfaceLocale: string,
    ifMatch: string | string[] | undefined,
  ): Promise<{ user: UserResponse; lockVersion: number }> {
    const db = this.trxOrDb();
    const current = await this.loadUser(userId);
    assertProductAccess(current.status);
    assertIfMatch(current.lockVersion, ifMatch);

    const updated = await sql<{
      id: string;
      status: AccountStatus;
      primary_email: string | null;
      interface_locale: string;
      country_code: string | null;
      birth_year: number | null;
      age_gate_confirmed_at: Date | null;
      lock_version: number;
      created_at: Date;
      updated_at: Date;
    }>`
      UPDATE iam.users AS u
      SET
        interface_locale = ${interfaceLocale},
        updated_at = now(),
        lock_version = u.lock_version + 1
      WHERE u.id = ${userId}::uuid
        AND u.lock_version = ${current.lockVersion}
      RETURNING
        u.id,
        u.status,
        u.primary_email,
        u.interface_locale,
        u.country_code,
        u.birth_year,
        u.age_gate_confirmed_at,
        u.lock_version,
        u.created_at,
        u.updated_at
    `.execute(db);

    const row = updated.rows[0];
    if (!row) {
      throw new ConflictException({
        code: "etag_mismatch",
        detail: "If-Match does not match the current resource version.",
      });
    }

    const product: ProductUserRow = {
      id: row.id,
      status: row.status,
      primaryEmail: row.primary_email,
      interfaceLocale: row.interface_locale,
      countryCode: row.country_code,
      birthYear: row.birth_year,
      ageGateConfirmedAt: row.age_gate_confirmed_at,
      lockVersion: row.lock_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      roles: current.roles,
    };
    return { user: toUserResponse(product), lockVersion: product.lockVersion };
  }

  /**
   * Year-only adult age gate. Rejects underage confirmation; does not mutate
   * the row on failure. Successful confirm sets birth_year + age_gate_confirmed_at.
   */
  async confirmAgeGate(userId: string, birthYear: number): Promise<UserResponse> {
    if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > 2100) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "birthYear must be an integer between 1900 and 2100.",
      });
    }
    if (!isAdultBirthYear(birthYear)) {
      throw new ForbiddenException({
        code: "age_gate_rejected",
        detail: `Users must be at least ${MINIMUM_ADULT_AGE} years old.`,
      });
    }

    const db = this.trxOrDb();
    const current = await this.loadUser(userId);
    assertProductAccess(current.status);

    const updated = await sql<{
      id: string;
      status: AccountStatus;
      primary_email: string | null;
      interface_locale: string;
      country_code: string | null;
      birth_year: number | null;
      age_gate_confirmed_at: Date | null;
      lock_version: number;
      created_at: Date;
      updated_at: Date;
    }>`
      UPDATE iam.users AS u
      SET
        birth_year = ${birthYear},
        age_gate_confirmed_at = now(),
        updated_at = now(),
        lock_version = u.lock_version + 1
      WHERE u.id = ${userId}::uuid
      RETURNING
        u.id,
        u.status,
        u.primary_email,
        u.interface_locale,
        u.country_code,
        u.birth_year,
        u.age_gate_confirmed_at,
        u.lock_version,
        u.created_at,
        u.updated_at
    `.execute(db);

    const row = updated.rows[0];
    if (!row) {
      throw new NotFoundException({ code: "not_found", detail: "User was not found." });
    }

    return toUserResponse({
      id: row.id,
      status: row.status,
      primaryEmail: row.primary_email,
      interfaceLocale: row.interface_locale,
      countryCode: row.country_code,
      birthYear: row.birth_year,
      ageGateConfirmedAt: row.age_gate_confirmed_at,
      lockVersion: row.lock_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      roles: current.roles,
    });
  }

  /**
   * Logical account deletion start (DM-035). Sets status=deletion_pending;
   * deleted_at stays null until privacy erasure (DM-050). Cognito global
   * sign-out is deferred to the privacy workflow.
   */
  async initiateDeletion(userId: string): Promise<UserResponse> {
    const db = this.trxOrDb();
    const current = await this.loadUser(userId);
    if (current.status === "deleted") {
      throw new ForbiddenException({
        code: "account_access_denied",
        detail: "Account is already deleted.",
      });
    }
    if (current.status === "deletion_pending") {
      return toUserResponse(current);
    }
    assertProductAccess(current.status);

    const updated = await sql<{
      id: string;
      status: AccountStatus;
      primary_email: string | null;
      interface_locale: string;
      country_code: string | null;
      birth_year: number | null;
      age_gate_confirmed_at: Date | null;
      lock_version: number;
      created_at: Date;
      updated_at: Date;
    }>`
      UPDATE iam.users AS u
      SET
        status = 'deletion_pending'::iam.account_status,
        updated_at = now(),
        lock_version = u.lock_version + 1
      WHERE u.id = ${userId}::uuid
        AND u.status = 'active'::iam.account_status
      RETURNING
        u.id,
        u.status,
        u.primary_email,
        u.interface_locale,
        u.country_code,
        u.birth_year,
        u.age_gate_confirmed_at,
        u.lock_version,
        u.created_at,
        u.updated_at
    `.execute(db);

    const row = updated.rows[0];
    if (!row) {
      throw new ForbiddenException({
        code: "account_access_denied",
        detail: "Account cannot enter deletion_pending.",
      });
    }

    return toUserResponse({
      id: row.id,
      status: row.status,
      primaryEmail: row.primary_email,
      interfaceLocale: row.interface_locale,
      countryCode: row.country_code,
      birthYear: row.birth_year,
      ageGateConfirmedAt: row.age_gate_confirmed_at,
      lockVersion: row.lock_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      roles: current.roles,
    });
  }

  private async loadUser(userId: string): Promise<ProductUserRow> {
    const store = getRequestStore();

    const run = async (executor: Kysely<Database> | Transaction<Database>) => {
      const rows = await sql<{
        out_user_id: string;
        out_status: AccountStatus;
        out_primary_email: string | null;
        out_interface_locale: string;
        out_country_code: string | null;
        out_birth_year: number | null;
        out_age_gate_confirmed_at: Date | null;
        out_lock_version: number;
        out_created_at: Date;
        out_updated_at: Date;
        out_roles: string[] | null;
      }>`
        SELECT *
        FROM ops.get_product_user(${userId}::uuid)
      `.execute(executor);

      const user = rows.rows[0];
      if (!user) {
        throw new NotFoundException({ code: "not_found", detail: "User was not found." });
      }

      return {
        id: user.out_user_id,
        status: user.out_status,
        primaryEmail: user.out_primary_email,
        interfaceLocale: user.out_interface_locale,
        countryCode: user.out_country_code,
        birthYear: user.out_birth_year,
        ageGateConfirmedAt: user.out_age_gate_confirmed_at,
        lockVersion: user.out_lock_version,
        createdAt: user.out_created_at,
        updatedAt: user.out_updated_at,
        roles: parseRoles(user.out_roles),
      } satisfies ProductUserRow;
    };

    if (store?.trx) {
      return run(store.trx);
    }

    return this.requireDb()
      .transaction()
      .execute(async (trx) => {
        await sql`SET LOCAL ROLE dm_api`.execute(trx);
        await sql`SELECT set_config('app.user_id', ${userId}, true)`.execute(trx);
        const roles = store?.actor?.roles?.join(",") ?? "learner";
        await sql`SELECT set_config('app.roles', ${roles}, true)`.execute(trx);
        return run(trx);
      });
  }
}
