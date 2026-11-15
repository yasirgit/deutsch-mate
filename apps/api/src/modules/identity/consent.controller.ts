/**
 * Consent routes (OpenAPI Identity consent operations).
 */

import { Body, Controller, Get, Post } from "@nestjs/common";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID } from "class-validator";

import { RequireIdempotency } from "../../platform/idempotency/index.js";
import { requireRequestStore } from "../../platform/request-context.js";
import {
  ConsentService,
  type ConsentDecision,
  type ConsentEventDto,
  type ConsentPurpose,
  type ConsentSource,
  type LegalDocumentVersionDto,
} from "./consent.service.js";

export class ConsentEventInputDto {
  @IsOptional()
  @IsUUID("7")
  documentVersionId?: string;

  @IsIn(["terms", "privacy", "marketing"])
  purposeCode!: ConsentPurpose;

  @IsIn(["granted", "withdrawn", "declined"])
  decision!: ConsentDecision;

  @IsIn(["web", "ios", "android"])
  source!: ConsentSource;
}

export class RecordConsentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  events!: ConsentEventInputDto[];
}

@Controller("me/consents")
export class ConsentController {
  constructor(private readonly consents: ConsentService) {}

  @Get("requirements")
  async getRequirements(): Promise<{
    documents: LegalDocumentVersionDto[];
    purposes: readonly ["marketing"];
  }> {
    if (!requireRequestStore().actor) {
      throw new Error("expected authenticated actor");
    }
    return this.consents.getRequirements();
  }

  @Get()
  async listCurrent(): Promise<{ items: ConsentEventDto[] }> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    return this.consents.listCurrentConsents(actor.userId);
  }

  @Post()
  @RequireIdempotency({ scope: "identity.consents.record", retention: "default" })
  async record(@Body() body: RecordConsentsDto): Promise<{ items: ConsentEventDto[] }> {
    const actor = requireRequestStore().actor;
    if (!actor) {
      throw new Error("expected authenticated actor");
    }
    return this.consents.recordConsentEvents(actor.userId, body.events);
  }
}
