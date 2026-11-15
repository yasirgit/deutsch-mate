/**
 * Current-user routes (OpenAPI Identity: getCurrentUser / updateCurrentUser).
 */

import { Body, Controller, Get, Headers, Patch, Res } from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";
import type { Response } from "express";

import { formatLockVersionEtag } from "../../platform/etag.js";
import { RequireIdempotency } from "../../platform/idempotency/index.js";
import { requireRequestStore } from "../../platform/request-context.js";
import { IdentityService, type UserResponse } from "./identity.service.js";

export class UserPatchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(16)
  interfaceLocale!: string;
}

@Controller("me")
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  async getCurrentUser(@Res({ passthrough: true }) res: Response): Promise<UserResponse> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    const { user, lockVersion } = await this.identity.getCurrentUser(actor.userId);
    res.setHeader("ETag", formatLockVersionEtag(lockVersion));
    return user;
  }

  @Patch()
  @RequireIdempotency({ scope: "identity.me.update", retention: "default" })
  async updateCurrentUser(
    @Body() body: UserPatchDto,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponse> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    const { user, lockVersion } = await this.identity.updateInterfaceLocale(
      actor.userId,
      body.interfaceLocale,
      ifMatch,
    );
    res.setHeader("ETag", formatLockVersionEtag(lockVersion));
    return user;
  }
}
