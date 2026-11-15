/**
 * Shared Nest testing application for platform contract/integration suites.
 */

import "reflect-metadata";

import express from "express";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { HealthController } from "../../health/health.controller.js";
import { PlatformModule } from "../platform.module.js";
import { PlatformProbeController } from "../probes/platform-probe.controller.js";
import { requestIdMiddleware } from "../request-context.js";
import { createValidationPipe } from "../validation.pipe.js";

export async function createPlatformApp(options?: {
  readonly includeProbes?: boolean;
}): Promise<INestApplication> {
  const includeProbes = options?.includeProbes !== false;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule.register()],
    controllers: [HealthController, ...(includeProbes ? [PlatformProbeController] : [])],
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
