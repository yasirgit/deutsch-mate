import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "dm:isPublic";

/** Marks a route as unauthenticated (health, published plans, Stripe webhook). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
