/**
 * Liveness/readiness per the `Health` schema in `docs/openapi.yaml`.
 *
 * Liveness is process-only (deploy-safe under dependency outage).
 * Readiness checks critical dependencies (PostgreSQL) and returns 503
 * Problem Details when unavailable.
 */

import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { sql, type Kysely } from "kysely";

import type { Database } from "@deutsch-mate/database";

import { Public } from "../platform/auth/public.decorator.js";
import { KYSELY } from "../platform/database.tokens.js";
import type { HealthStatus } from "./health.types.js";

@Controller("health")
export class HealthController {
  constructor(@Optional() @Inject(KYSELY) private readonly db: Kysely<Database> | null) {}

  @Public()
  @Get("live")
  getLiveness(): HealthStatus {
    return { status: "ok", checkedAt: new Date().toISOString() };
  }

  @Public()
  @Get("ready")
  async getReadiness(): Promise<HealthStatus> {
    if (!this.db) {
      throw new ServiceUnavailableException({
        code: "dependency_unavailable",
        detail: "Database is not configured.",
      });
    }
    try {
      await sql`SELECT 1`.execute(this.db);
    } catch {
      throw new HttpException(
        {
          code: "dependency_unavailable",
          detail: "Database is not ready.",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: "ok", checkedAt: new Date().toISOString() };
  }
}
