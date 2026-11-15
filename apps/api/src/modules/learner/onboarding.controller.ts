/**
 * Onboarding routes (OpenAPI: get/update/complete onboarding).
 */

import { Body, Controller, Get, Headers, HttpCode, Patch, Post, Res } from "@nestjs/common";
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import type { Response } from "express";

import type { UnitSummaryDto } from "../content/curriculum.service.js";
import { formatLockVersionEtag } from "../../platform/etag.js";
import { RequireIdempotency } from "../../platform/idempotency/index.js";
import { requireRequestStore } from "../../platform/request-context.js";
import {
  OnboardingService,
  type OnboardingStateDto,
} from "./onboarding.service.js";

export class OnboardingPatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  stepCode?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  completedSteps?: string[];
}

@Controller("me/onboarding")
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  async getState(@Res({ passthrough: true }) res: Response): Promise<OnboardingStateDto> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    const { onboarding, lockVersion } = await this.onboarding.getState(actor.userId);
    res.setHeader("ETag", formatLockVersionEtag(lockVersion));
    return onboarding;
  }

  @Patch()
  @RequireIdempotency({ scope: "learner.onboarding.update", retention: "default" })
  async patchState(
    @Body() body: OnboardingPatchDto,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OnboardingStateDto> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    const { onboarding, lockVersion } = await this.onboarding.patchState(
      actor.userId,
      body,
      ifMatch,
    );
    res.setHeader("ETag", formatLockVersionEtag(lockVersion));
    return onboarding;
  }

  @Post("complete")
  @HttpCode(200)
  @RequireIdempotency({ scope: "learner.onboarding.complete", retention: "default" })
  async complete(): Promise<{
    onboarding: OnboardingStateDto;
    recommendedUnit: UnitSummaryDto;
  }> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    return this.onboarding.complete(actor.userId);
  }
}
