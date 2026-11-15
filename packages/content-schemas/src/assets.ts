import { z } from "zod";

import { AssetPurposeSchema, Sha256HexSchema } from "./enums.js";
import { AssetKeySchema } from "./keys.js";
import { RichTextDocSchema } from "./rich-text.js";

/**
 * Authoring-time asset references. Import (DM-030) resolves these to
 * `media.objects` / `content.activity_assets`; schemas only constrain shape.
 */

export const ActivityAssetAuthoringSchema = z
  .object({
    assetKey: AssetKeySchema,
    purpose: AssetPurposeSchema,
    ordinal: z.number().int().positive().default(1),
    contentType: z
      .string()
      .min(3)
      .max(100)
      .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i, "expected MIME type"),
    /** Relative path under the content package (not a signed URL). */
    sourcePath: z
      .string()
      .min(1)
      .max(240)
      .regex(/^[a-z0-9][a-z0-9._/-]*$/i, "relative asset path"),
    sha256: Sha256HexSchema,
    altText: z.string().min(1).max(500).optional(),
    transcript: RichTextDocSchema.optional(),
  })
  .strict()
  .superRefine((asset, ctx) => {
    if (asset.purpose === "audio" && asset.altText === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "audio assets require altText for accessibility",
        path: ["altText"],
      });
    }
    if (asset.purpose === "image" && asset.altText === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "image assets require altText for accessibility",
        path: ["altText"],
      });
    }
  });
export type ActivityAssetAuthoring = z.infer<typeof ActivityAssetAuthoringSchema>;
