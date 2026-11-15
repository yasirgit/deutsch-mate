/**
 * Shared Nest testing app for identity contract/integration/security suites.
 */

import "reflect-metadata";

import express from "express";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { HealthController } from "../../../health/health.controller.js";
import { IdentityModule, type IdentityModuleOptions } from "../identity.module.js";
import { PlatformModule } from "../../../platform/platform.module.js";
import { requestIdMiddleware } from "../../../platform/request-context.js";
import { createValidationPipe } from "../../../platform/validation.pipe.js";

export async function createIdentityApp(
  options: IdentityModuleOptions = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [IdentityModule.register(options), PlatformModule.register()],
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
