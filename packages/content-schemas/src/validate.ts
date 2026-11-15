import { z } from "zod";

import { ContentAuthoringDocumentSchema, type ContentAuthoringDocument } from "./curriculum.js";
import { FORBIDDEN_ACTIVITY_TYPES } from "./enums.js";
import { FORBIDDEN_ANSWER_SPEC_KINDS } from "./answers.js";
import { FORBIDDEN_RICH_TEXT_NODE_TYPES } from "./rich-text.js";

export class ContentValidationError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[]) {
    super(message);
    this.name = "ContentValidationError";
    this.issues = issues;
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

/**
 * Recursively scan for forbidden authoring constructs that might sneak past
 * discriminated unions when authors hand-edit JSON (HTML nodes, executable
 * answer kinds, speaking/assessment activity types).
 */
function collectForbiddenConstructs(value: unknown, path: string, found: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectForbiddenConstructs(item, `${path}[${index}]`, found);
    });
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  const record = value as Record<string, unknown>;
  const type = record["type"];
  if (typeof type === "string") {
    if ((FORBIDDEN_RICH_TEXT_NODE_TYPES as readonly string[]).includes(type)) {
      found.push(`${path}.type: forbidden rich-text node "${type}"`);
    }
    if ((FORBIDDEN_ACTIVITY_TYPES as readonly string[]).includes(type)) {
      found.push(`${path}.type: forbidden activity type "${type}"`);
    }
  }
  const kind = record["kind"];
  if (
    typeof kind === "string" &&
    (FORBIDDEN_ANSWER_SPEC_KINDS as readonly string[]).includes(kind)
  ) {
    found.push(`${path}.kind: forbidden answer expression kind "${kind}"`);
  }
  for (const [key, child] of Object.entries(record)) {
    collectForbiddenConstructs(child, path === "(root)" ? key : `${path}.${key}`, found);
  }
}

export interface ValidateContentDocumentResult {
  readonly document: ContentAuthoringDocument;
}

/**
 * Parse and validate a content authoring document. Unknown fields, forbidden
 * constructs, and schema violations fail deterministically.
 */
export function validateContentDocument(input: unknown): ValidateContentDocumentResult {
  const forbidden: string[] = [];
  collectForbiddenConstructs(input, "(root)", forbidden);
  if (forbidden.length > 0) {
    throw new ContentValidationError(
      `Forbidden content constructs: ${forbidden.join("; ")}`,
      forbidden,
    );
  }

  const result = ContentAuthoringDocumentSchema.safeParse(input);
  if (!result.success) {
    const issues = formatIssues(result.error);
    throw new ContentValidationError(
      `Invalid content authoring document: ${issues.join("; ")}`,
      issues,
    );
  }
  return { document: result.data };
}

export function safeValidateContentDocument(
  input: unknown,
):
  | { readonly success: true; readonly document: ContentAuthoringDocument }
  | { readonly success: false; readonly error: ContentValidationError } {
  try {
    const { document } = validateContentDocument(input);
    return { success: true, document };
  } catch (error) {
    if (error instanceof ContentValidationError) {
      return { success: false, error };
    }
    throw error;
  }
}
