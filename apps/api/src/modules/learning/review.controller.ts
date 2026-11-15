/**
 * Review item query routes (OpenAPI listReviewItems).
 */

import { Controller, Get, Query } from "@nestjs/common";

import { requireRequestStore } from "../../platform/request-context.js";
import { ReviewService, type ReviewItemPageDto } from "./review.service.js";

@Controller()
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Get("learning/review-items")
  async list(
    @Query("state") state: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
  ): Promise<ReviewItemPageDto> {
    const store = requireRequestStore();
    if (!store.actor) {
      throw new Error("authenticated actor required");
    }
    return this.reviews.listReviewItems(store.actor, {
      ...(state !== undefined ? { state } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
  }
}
