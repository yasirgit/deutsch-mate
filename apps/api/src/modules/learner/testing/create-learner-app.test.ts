/**
 * Shared Nest testing app for learner contract/integration/e2e suites.
 */

import "reflect-metadata";

import express from "express";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { HealthController } from "../../../health/health.controller.js";
import {
  IdentityModule,
  type IdentityModuleOptions,
} from "../../identity/identity.module.js";
import { ContentModule } from "../../content/content.module.js";
import { PlatformModule } from "../../../platform/platform.module.js";
import { requestIdMiddleware } from "../../../platform/request-context.js";
import { createValidationPipe } from "../../../platform/validation.pipe.js";
import { LearnerModule } from "../learner.module.js";

export async function createLearnerApp(
  options: IdentityModuleOptions = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      IdentityModule.register(options),
      PlatformModule.register(),
      ContentModule,
      LearnerModule,
    ],
    controllers: [HealthController],
  }).compile();

  const app = moduleRef.createNestApplication({ bodyParser: false });
  app.setGlobalPrefix("v1");
  app.use(express.json({ type: ["application/json", "application/merge-patch+json"] }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestIdMiddleware);
  app.useGlobalPipes(createValidationPipe());
  await app.init();
  return app;
}
