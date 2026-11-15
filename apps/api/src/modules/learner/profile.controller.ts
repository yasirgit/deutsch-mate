/**
 * Profile routes (OpenAPI Identity: getCurrentProfile / updateCurrentProfile).
 */

import { Body, Controller, Get, Headers, HttpCode, Put, Res } from "@nestjs/common";
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import type { Response } from "express";

import { formatLockVersionEtag } from "../../platform/etag.js";
import { RequireIdempotency } from "../../platform/idempotency/index.js";
import { requireRequestStore } from "../../platform/request-context.js";
import {
  ProfileService,
  type GoalCode,
  type ProfileVersionDto,
} from "./profile.service.js";
import type { CefrLevel } from "./proficiency.service.js";

const GOALS = ["relocation", "work", "study", "travel", "daily_life", "general"] as const;
const LEVELS = ["A1", "A2", "B1", "B2"] as const;

export class ProfileInputDto {
  @IsIn([...GOALS])
  goal!: GoalCode;

  @IsIn([...LEVELS])
  selectedLevel!: CefrLevel;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn([...LEVELS])
  targetLevel?: CefrLevel | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(5)
  @Max(180)
  studyMinutesPerDay?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(7)
  studyDaysPerWeek?: number | null;

  @IsObject()
  preferences!: Record<string, unknown>;
}

@Controller("me/profile")
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  async getCurrent(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProfileVersionDto> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    const { profile, etagVersion } = await this.profiles.getCurrentProfile(actor.userId);
    res.setHeader("ETag", formatLockVersionEtag(etagVersion));
    return profile;
  }

  @Put()
  @HttpCode(201)
  @RequireIdempotency({ scope: "learner.profile.update", retention: "default" })
  async updateCurrent(
    @Body() body: ProfileInputDto,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProfileVersionDto> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    const { profile, etagVersion } = await this.profiles.appendProfileVersion(
      actor.userId,
      body,
      ifMatch,
    );
    res.setHeader("ETag", formatLockVersionEtag(etagVersion));
    return profile;
  }
}
