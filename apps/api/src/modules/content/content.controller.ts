/**
 * Protected content ops routes (OpenAPI Operations: curriculum governance).
 */

import { Body, Controller, HttpCode, Param, Post, BadRequestException } from "@nestjs/common";
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import { RequireIdempotency } from "../../platform/idempotency/index.js";
import { SerializableIsolation } from "../../platform/request-transaction.interceptor.js";
import { requireRequestStore } from "../../platform/request-context.js";
import {
  ContentService,
  type CurriculumReleaseDto,
  type HumanReviewAction,
  type ReviewEventDto,
} from "./content.service.js";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CurriculumReleaseInputDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  releaseKey!: string;

  @IsInt()
  @Min(1)
  version!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  manifestSha256!: string;
}

export class ReviewEventInputDto {
  @IsIn(["submitted", "approved", "rejected", "retired", "rollback_selected"])
  action!: HumanReviewAction;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  qualification?: string | null;

  @IsObject()
  validationResult!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;
}

@Controller("ops/content/releases")
export class ContentOpsController {
  constructor(private readonly content: ContentService) {}

  @Post()
  @RequireIdempotency({ scope: "content.release.create", retention: "default" })
  async create(@Body() body: CurriculumReleaseInputDto): Promise<CurriculumReleaseDto> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    return this.content.createRelease(actor, body);
  }

  @Post(":releaseId/review-events")
  @RequireIdempotency({ scope: "content.release.review", retention: "default" })
  async review(
    @Param("releaseId") releaseId: string,
    @Body() body: ReviewEventInputDto,
  ): Promise<ReviewEventDto> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    if (!UUID_V7_RE.test(releaseId)) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "releaseId must be a UUIDv7.",
      });
    }
    return this.content.recordReviewEvent(actor, releaseId, body);
  }

  @Post(":releaseId/publish")
  @HttpCode(200)
  @SerializableIsolation()
  @RequireIdempotency({ scope: "content.release.publish", retention: "default" })
  async publish(@Param("releaseId") releaseId: string): Promise<CurriculumReleaseDto> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    if (!UUID_V7_RE.test(releaseId)) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "releaseId must be a UUIDv7.",
      });
    }
    return this.content.publishRelease(actor, releaseId);
  }

  @Post(":releaseId/rollback")
  @HttpCode(200)
  @SerializableIsolation()
  @RequireIdempotency({ scope: "content.release.rollback", retention: "default" })
  async rollback(@Param("releaseId") releaseId: string): Promise<CurriculumReleaseDto> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    if (!UUID_V7_RE.test(releaseId)) {
      throw new BadRequestException({
        code: "validation_failed",
        detail: "releaseId must be a UUIDv7.",
      });
    }
    return this.content.rollbackRelease(actor, releaseId);
  }
}
