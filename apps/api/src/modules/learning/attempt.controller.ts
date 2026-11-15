/**
 * Activity attempt routes (OpenAPI submitActivityAttempt / getActivityAttempt).
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import type { Response } from "express";

import { RequireIdempotency } from "../../platform/idempotency/index.js";
import { requireRequestStore } from "../../platform/request-context.js";
import { AttemptService, type ActivityAttemptDto } from "./attempt.service.js";

export class AttemptResponseInputDto {
  @IsIn(["structured", "choice", "text"])
  responseKind!: "structured" | "choice" | "text";

  @ValidateIf((o: AttemptResponseInputDto) => o.responseKind !== "text")
  @IsObject()
  response?: Record<string, unknown>;

  @ValidateIf((o: AttemptResponseInputDto) => o.responseKind === "text")
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  textContent?: string;
}

export class ActivityAttemptInputDto {
  @IsUUID("7")
  activityVersionId!: string;

  @IsUUID("7")
  clientAttemptId!: string;

  @IsInt()
  @Min(1)
  attemptNumber!: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(0)
  durationMs?: number | null;

  @ValidateNested()
  @Type(() => AttemptResponseInputDto)
  response!: AttemptResponseInputDto;
}

@Controller()
export class AttemptController {
  constructor(private readonly attempts: AttemptService) {}

  @Post("learning/sessions/:sessionId/attempts")
  @RequireIdempotency({ scope: "learning.attempts.submit", retention: "attempt" })
  async submit(
    @Param("sessionId") sessionId: string,
    @Body() body: ActivityAttemptInputDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ActivityAttemptDto> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    const result = await this.attempts.submitAttempt(actor, sessionId, {
      activityVersionId: body.activityVersionId,
      clientAttemptId: body.clientAttemptId,
      attemptNumber: body.attemptNumber,
      durationMs: body.durationMs ?? null,
      response: {
        responseKind: body.response.responseKind,
        ...(body.response.response !== undefined ? { response: body.response.response } : {}),
        ...(body.response.textContent !== undefined
          ? { textContent: body.response.textContent }
          : {}),
      },
    });
    res.status(result.httpStatus);
    if (result.httpStatus === 202) {
      res.setHeader("Location", `/v1/learning/attempts/${result.attempt.id}`);
    }
    return result.attempt;
  }

  @Get("learning/attempts/:attemptId")
  @HttpCode(200)
  async get(@Param("attemptId") attemptId: string): Promise<ActivityAttemptDto> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    return this.attempts.getAttempt(actor, attemptId);
  }
}
