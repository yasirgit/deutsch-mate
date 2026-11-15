/**
 * Test-only platform probe routes used by contract/integration suites.
 * Not registered in production AppModule.
 */

import { Body, Controller, Get, Headers, Patch, Post, Res } from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";
import { createUuidV7 } from "@deutsch-mate/domain";
import type { Response } from "express";
import { sql } from "kysely";

import { Public } from "../auth/public.decorator.js";
import { assertIfMatch, formatLockVersionEtag } from "../etag.js";
import { RequireIdempotency } from "../idempotency/index.js";
import { requireRequestStore } from "../request-context.js";
import { Transactional } from "../request-transaction.interceptor.js";

export class ProbeEchoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  message!: string;
}

@Controller("platform/probes")
export class PlatformProbeController {
  private lockVersion = 1;

  /** Strict body validation: unknown fields must fail. */
  @Post("echo")
  echo(@Body() body: ProbeEchoDto): { message: string } {
    return { message: body.message };
  }

  /** Actor comes from AuthGuard only — body userId is ignored if present. */
  @Get("me")
  me(): { userId: string; roles: readonly string[] } {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    return { userId: actor.userId, roles: actor.roles };
  }

  @Patch("resource")
  patchResource(
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): { lockVersion: number } {
    assertIfMatch(this.lockVersion, ifMatch);
    this.lockVersion += 1;
    res.setHeader("ETag", formatLockVersionEtag(this.lockVersion));
    return { lockVersion: this.lockVersion };
  }

  @Post("command")
  @RequireIdempotency({ scope: "platform.probe.command", retention: "default" })
  command(@Body() body: ProbeEchoDto): {
    id: string;
    resourceType: string;
    message: string;
  } {
    return {
      id: createUuidV7(),
      resourceType: "platform.probe",
      message: body.message,
    };
  }

  /** Verifies correlation_id is set on the request transaction. */
  @Post("correlation")
  @Transactional()
  async correlation(): Promise<{ correlationId: string; requestId: string }> {
    const store = requireRequestStore();
    if (!store.trx) {
      throw new Error("expected request transaction");
    }
    const result = await sql<{ v: string | null }>`
      SELECT nullif(current_setting('app.correlation_id', true), '') AS v
    `.execute(store.trx);
    return {
      correlationId: result.rows[0]?.v ?? "",
      requestId: store.requestId,
    };
  }

  /** Deliberately throws an Error containing SQL-like text to prove sanitization. */
  @Public()
  @Get("boom")
  boom(): never {
    throw new Error("SELECT password FROM secrets WHERE token = 'x'");
  }
}
