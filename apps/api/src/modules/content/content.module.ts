/**
 * Content capability module: protected governance (DM-031) + published
 * curriculum delivery (DM-032).
 */

import { Module } from "@nestjs/common";

import { ContentOpsController } from "./content.controller.js";
import { ContentService } from "./content.service.js";
import { CurriculumCache } from "./curriculum.cache.js";
import { CurriculumController } from "./curriculum.controller.js";
import { CurriculumService } from "./curriculum.service.js";

@Module({
  controllers: [ContentOpsController, CurriculumController],
  providers: [ContentService, CurriculumService, CurriculumCache],
  exports: [ContentService, CurriculumService],
})
export class ContentModule {}
