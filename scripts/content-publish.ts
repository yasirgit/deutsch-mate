#!/usr/bin/env node
/**
 * Staff helper: submit → approve → publish a draft curriculum release via the
 * Product API (DM-031). Uses local test actor headers — never for production.
 *
 * Env:
 *   API_BASE_URL (default http://127.0.0.1:3001/v1)
 *   DM_EDITOR_USER_ID / DM_REVIEWER_USER_ID — distinct staff UUIDs
 *   RELEASE_ID — draft release to govern
 *
 * Usage: pnpm content:publish -- --release-id <uuid>
 */
import { createUuidV7 } from "@deutsch-mate/domain";

const base = (process.env["API_BASE_URL"] ?? "http://127.0.0.1:3001/v1").replace(/\/$/, "");
const editorId = process.env["DM_EDITOR_USER_ID"];
const reviewerId = process.env["DM_REVIEWER_USER_ID"];

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit?.slice(pref.length);
}

const releaseId = argValue("--release-id") ?? process.env["RELEASE_ID"];

if (!releaseId || !editorId || !reviewerId) {
  console.error(
    "Usage: DM_EDITOR_USER_ID=… DM_REVIEWER_USER_ID=… pnpm content:publish -- --release-id <uuid>",
  );
  process.exit(1);
}
if (editorId === reviewerId) {
  console.error("Editor and reviewer must be distinct (no self-approval).");
  process.exit(1);
}

async function post(
  path: string,
  actorId: string,
  roles: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": createUuidV7(),
      "x-dm-test-actor": actorId,
      "x-dm-test-roles": roles,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const submitted = await post(
  `/ops/content/releases/${releaseId}/review-events`,
  editorId,
  "content_reviewer",
  { action: "submitted", validationResult: { source: "content:publish script" } },
);
if (!submitted.ok && submitted.status !== 409) {
  console.error("submit failed", submitted.status, await submitted.text());
  process.exit(1);
}

const approved = await post(
  `/ops/content/releases/${releaseId}/review-events`,
  reviewerId,
  "content_reviewer",
  {
    action: "approved",
    validationResult: { source: "content:publish script" },
    qualification: "scripted local approval",
  },
);
if (!approved.ok && approved.status !== 409) {
  console.error("approve failed", approved.status, await approved.text());
  process.exit(1);
}

const published = await post(
  `/ops/content/releases/${releaseId}/publish`,
  reviewerId,
  "content_reviewer",
);
if (!published.ok) {
  console.error("publish failed", published.status, await published.text());
  process.exit(1);
}

const body = (await published.json()) as { id: string; status: string; manifestSha256: string };
console.log("content:publish OK");
console.log(`  releaseId=${body.id} status=${body.status} manifestSha256=${body.manifestSha256}`);
