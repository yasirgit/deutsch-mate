import "reflect-metadata";

import express from "express";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { requestIdMiddleware } from "./platform/request-context.js";
import { createValidationPipe } from "./platform/validation.pipe.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.setGlobalPrefix("v1");
  // OpenAPI uses application/merge-patch+json for PATCH /me and similar.
  app.use(express.json({ type: ["application/json", "application/merge-patch+json"] }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestIdMiddleware);
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
  const port = Number(process.env["PORT"] ?? process.env["API_PORT"] ?? 3001);
  await app.listen(port);
}

void bootstrap();
