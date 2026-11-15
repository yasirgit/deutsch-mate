/**
 * Learner curriculum routes (DM-032): published-only immutable delivery.
 * OpenAPI: getCurrentCurriculumRelease, listCurriculumModules,
 * getCurriculumUnit, getLesson.
 */

import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  NotFoundException,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import { matchesIfNoneMatch } from "../../platform/etag.js";
import {
  CurriculumService,
  requireCurriculumActor,
  type CurriculumReleaseDto,
  type LessonDto,
  type ModulePageDto,
  type UnitDto,
} from "./curriculum.service.js";

@Controller()
export class CurriculumController {
  constructor(private readonly curriculum: CurriculumService) {}

  @Get("curriculum/releases/current")
  async getCurrent(
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CurriculumReleaseDto | void> {
    requireCurriculumActor();
    const result = await this.curriculum.getCurrentPublishedRelease();
    if (!result) {
      throw new NotFoundException({
        code: "not_found",
        detail: "No published curriculum release is current.",
      });
    }
    res.setHeader("ETag", result.etag);
    if (matchesIfNoneMatch(ifNoneMatch, result.etag)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return;
    }
    return result.release;
  }

  @Get("curriculum/releases/:releaseId/modules")
  async listModules(
    @Param("releaseId") releaseId: string,
    @Query("level") level: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
  ): Promise<ModulePageDto> {
    const { entitlement } = requireCurriculumActor();
    return this.curriculum.listModules(
      releaseId,
      {
        ...(level !== undefined ? { level } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
        ...(limit !== undefined ? { limit } : {}),
      },
      entitlement,
    );
  }

  @Get("curriculum/units/:unitVersionId")
  async getUnit(
    @Param("unitVersionId") unitVersionId: string,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UnitDto | void> {
    const { entitlement } = requireCurriculumActor();
    const result = await this.curriculum.getUnit(unitVersionId, entitlement);
    res.setHeader("ETag", result.etag);
    if (matchesIfNoneMatch(ifNoneMatch, result.etag)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return;
    }
    return result.unit;
  }

  @Get("curriculum/lessons/:lessonVersionId")
  async getLesson(
    @Param("lessonVersionId") lessonVersionId: string,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LessonDto | void> {
    const { entitlement } = requireCurriculumActor();
    const result = await this.curriculum.getLesson(lessonVersionId, entitlement);
    res.setHeader("ETag", result.etag);
    if (matchesIfNoneMatch(ifNoneMatch, result.etag)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return;
    }
    return result.lesson;
  }
}
