import { z } from "zod";

import {
  AUTHORING_SCHEMA_VERSION,
  ModuleKeySchema,
  ReleaseKeySchema,
} from "@deutsch-mate/content-schemas";

/**
 * Release package metadata (not a curriculum document). Pins module versions
 * included in a draft import; status stays draft until DM-031 publish.
 */
export const ReleaseMetaSchema = z
  .object({
    schemaVersion: z.literal(AUTHORING_SCHEMA_VERSION),
    kind: z.literal("release"),
    releaseKey: ReleaseKeySchema,
    version: z.number().int().positive(),
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(2000),
    modules: z
      .array(
        z
          .object({
            ordinal: z.number().int().positive(),
            moduleKey: ModuleKeySchema,
            moduleVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict()
  .superRefine((release, ctx) => {
    const ordinals = release.modules.map((m) => m.ordinal);
    if (new Set(ordinals).size !== ordinals.length) {
      ctx.addIssue({
        code: "custom",
        message: "module ordinals must be unique within a release",
        path: ["modules"],
      });
    }
  });

export type ReleaseMeta = z.infer<typeof ReleaseMetaSchema>;
