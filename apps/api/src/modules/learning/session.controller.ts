/**
 * Learning session routes (OpenAPI Learning sessions).
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { IsIn, IsOptional, IsUUID, ValidateIf } from "class-validator";
import type { Response } from "express";

import { formatLockVersionEtag } from "../../platform/etag.js";
import { RequireIdempotency } from "../../platform/idempotency/index.js";
import { requireRequestStore } from "../../platform/request-context.js";
import {
  SessionService,
  type ClientPlatform,
  type LearningSessionDto,
} from "./session.service.js";

export class LearningSessionInputDto {
  @IsUUID("7")
  curriculumReleaseId!: string;

  @IsUUID("7")
  unitVersionId!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID("7")
  lessonVersionId?: string | null;

  @IsIn(["web", "ios", "android"])
  clientPlatform!: ClientPlatform;
}

export class UpdateLearningSessionDto {
  @IsIn(["completed", "abandoned"])
  status!: "completed" | "abandoned";
}

@Controller("learning/sessions")
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  async list(
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
  ): Promise<{
    readonly items: readonly LearningSessionDto[];
    readonly page: { readonly nextCursor: string | null };
  }> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    return this.sessions.listSessions(actor, {
      ...(cursor !== undefined ? { cursor } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
  }

  @Post()
  @HttpCode(201)
  @RequireIdempotency({ scope: "learning.sessions.create", retention: "default" })
  async create(
    @Body() body: LearningSessionInputDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LearningSessionDto> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    const { session, lockVersion } = await this.sessions.createSession(actor, {
      curriculumReleaseId: body.curriculumReleaseId,
      unitVersionId: body.unitVersionId,
      lessonVersionId: body.lessonVersionId ?? null,
      clientPlatform: body.clientPlatform,
    });
    res.setHeader("ETag", formatLockVersionEtag(lockVersion));
    return session;
  }

  @Get(":sessionId")
  async get(
    @Param("sessionId") sessionId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LearningSessionDto> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    const { session, lockVersion } = await this.sessions.getSession(actor, sessionId);
    res.setHeader("ETag", formatLockVersionEtag(lockVersion));
    return session;
  }

  @Patch(":sessionId")
  async update(
    @Param("sessionId") sessionId: string,
    @Body() body: UpdateLearningSessionDto,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LearningSessionDto> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    const { session, lockVersion } = await this.sessions.updateSession(
      actor,
      sessionId,
      body.status,
      ifMatch,
    );
    res.setHeader("ETag", formatLockVersionEtag(lockVersion));
    return session;
  }
}
