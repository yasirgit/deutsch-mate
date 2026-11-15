/**
 * Learning capability module: sessions, scoring, review projection (DM-038/039).
 */

import { Module } from "@nestjs/common";

import { ContentModule } from "../content/content.module.js";
import { AttemptController } from "./attempt.controller.js";
import { AttemptService } from "./attempt.service.js";
import { ReviewController } from "./review.controller.js";
import { ReviewService } from "./review.service.js";
import { SessionController } from "./session.controller.js";
import { SessionService } from "./session.service.js";

@Module({
  imports: [ContentModule],
  controllers: [SessionController, AttemptController, ReviewController],
  providers: [SessionService, AttemptService, ReviewService],
  exports: [SessionService, AttemptService, ReviewService],
})
export class LearningModule {}