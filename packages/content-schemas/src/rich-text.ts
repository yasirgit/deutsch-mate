import { z } from "zod";

/**
 * Schema-validated rich-text AST — never HTML or executable markup
 * (`docs/Database.md` lesson/activity JSON fields).
 *
 * Allowed structure is a small closed set of block/inline nodes. There is no
 * `html`, `raw`, `script`, or iframe node type.
 */

const PlainTextSchema = z.string().min(1).max(4000);

export type RichTextInline =
  | {
      readonly type: "text";
      readonly text: string;
      readonly marks?: readonly RichTextMark[] | undefined;
    }
  | { readonly type: "emphasis"; readonly children: readonly RichTextInline[] }
  | { readonly type: "strong"; readonly children: readonly RichTextInline[] }
  | { readonly type: "code"; readonly text: string };

export type RichTextMark = "bold" | "italic" | "underline";

export type RichTextBlock =
  | { readonly type: "paragraph"; readonly children: readonly RichTextInline[] }
  | {
      readonly type: "heading";
      readonly level: 2 | 3;
      readonly children: readonly RichTextInline[];
    }
  | {
      readonly type: "list";
      readonly ordered: boolean;
      readonly items: readonly { readonly children: readonly RichTextInline[] }[];
    }
  | { readonly type: "example"; readonly children: readonly RichTextInline[] }
  | {
      readonly type: "callout";
      readonly tone: "note" | "tip" | "warning";
      readonly children: readonly RichTextInline[];
    };

export type RichTextDoc = {
  readonly type: "doc";
  readonly version: 1;
  readonly blocks: readonly RichTextBlock[];
};

const RichTextMarkSchema = z.enum(["bold", "italic", "underline"]);

export const RichTextInlineSchema: z.ZodType<RichTextInline> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("text"),
        text: PlainTextSchema,
        marks: z.array(RichTextMarkSchema).max(3).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("emphasis"),
        children: z.array(RichTextInlineSchema).min(1).max(32),
      })
      .strict(),
    z
      .object({
        type: z.literal("strong"),
        children: z.array(RichTextInlineSchema).min(1).max(32),
      })
      .strict(),
    z
      .object({
        type: z.literal("code"),
        text: z.string().min(1).max(200),
      })
      .strict(),
  ]),
);

const ListItemSchema = z
  .object({
    children: z.array(RichTextInlineSchema).min(1).max(64),
  })
  .strict();

export const RichTextBlockSchema: z.ZodType<RichTextBlock> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("paragraph"),
        children: z.array(RichTextInlineSchema).min(1).max(64),
      })
      .strict(),
    z
      .object({
        type: z.literal("heading"),
        level: z.union([z.literal(2), z.literal(3)]),
        children: z.array(RichTextInlineSchema).min(1).max(32),
      })
      .strict(),
    z
      .object({
        type: z.literal("list"),
        ordered: z.boolean(),
        items: z.array(ListItemSchema).min(1).max(20),
      })
      .strict(),
    z
      .object({
        type: z.literal("example"),
        children: z.array(RichTextInlineSchema).min(1).max(64),
      })
      .strict(),
    z
      .object({
        type: z.literal("callout"),
        tone: z.enum(["note", "tip", "warning"]),
        children: z.array(RichTextInlineSchema).min(1).max(64),
      })
      .strict(),
  ]),
);

export const RichTextDocSchema: z.ZodType<RichTextDoc> = z
  .object({
    type: z.literal("doc"),
    version: z.literal(1),
    blocks: z.array(RichTextBlockSchema).min(1).max(100),
  })
  .strict();

/** Forbidden node type names that must never appear in authored rich text. */
export const FORBIDDEN_RICH_TEXT_NODE_TYPES = [
  "html",
  "raw",
  "script",
  "iframe",
  "embed",
  "component",
] as const;

export function paragraph(...texts: string[]): RichTextDoc {
  return {
    type: "doc",
    version: 1,
    blocks: [
      {
        type: "paragraph",
        children: texts.map((text) => ({ type: "text" as const, text })),
      },
    ],
  };
}
