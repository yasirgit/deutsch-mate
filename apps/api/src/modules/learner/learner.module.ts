/**
 * Learner capability module: profiles, onboarding, proficiency (DM-037).
 */

import { Module } from "@nestjs/common";

import { ContentModule } from "../content/content.module.js";
import { OnboardingController } from "./onboarding.controller.js";
import { OnboardingService } from "./onboarding.service.js";
import { ProfileController } from "./profile.controller.js";
import { ProfileService } from "./profile.service.js";
import { ProficiencyService } from "./proficiency.service.js";

@Module({
  imports: [ContentModule],
  controllers: [ProfileController, OnboardingController],
  providers: [ProfileService, OnboardingService, ProficiencyService],
  exports: [ProfileService, OnboardingService, ProficiencyService],
})
export class LearnerModule {}
