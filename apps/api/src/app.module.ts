import { Module } from "@nestjs/common";

import { HealthController } from "./health/health.controller.js";
import { ContentModule } from "./modules/content/content.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { LearnerModule } from "./modules/learner/learner.module.js";
import { LearningModule } from "./modules/learning/learning.module.js";
import { PlatformModule } from "./platform/platform.module.js";

@Module({
  imports: [
    IdentityModule.register(),
    PlatformModule.register(),
    ContentModule,
    LearnerModule,
    LearningModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
