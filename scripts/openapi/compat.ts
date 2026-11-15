/**
 * Compatibility gate for contract-first generation (DM-025 / NFR-010).
 * Asserts operationIds, RFC 9457 Problem fields, UUIDv7/decimal/bigint
 * primitives, and tutor SSE surface remain aligned with docs/openapi.yaml
 * and the committed generated/client helpers.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const openapiPath = path.join(repoRoot, "docs/openapi.yaml");
const generatedPath = path.join(repoRoot, "packages/api-schemas/src/generated/openapi.ts");
const primitivesPath = path.join(repoRoot, "packages/api-schemas/src/primitives.ts");
const ssePath = path.join(repoRoot, "packages/api-client/src/sse.ts");

/** Must match packages/api-schemas/src/primitives.ts and docs/openapi.yaml. */
const EXPECTED_UUID_V7 = "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const EXPECTED_DECIMAL = "^-?[0-9]+(?:\\.[0-9]+)?$";
const EXPECTED_BIG_INTEGER = "^-?[0-9]+$";
const EXPECTED_PROBLEM_FIELDS = [
  "type",
  "title",
  "status",
  "detail",
  "instance",
  "requestId",
  "code",
] as const;
const EXPECTED_SSE_EVENTS = [
  "run.started",
  "message.delta",
  "message.completed",
  "run.blocked",
  "run.failed",
  "run.completed",
] as const;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function fail(message: string): never {
  console.error(`openapi:compat — ${message}`);
  process.exit(1);
}

function asRecord(value: Json | undefined, label: string): { [key: string]: Json } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function extractTsStringArray(source: string, exportName: string): string[] {
  const match = new RegExp(`export const ${exportName} = \\[([\\s\\S]*?)\\] as const`).exec(source);
  if (match?.[1] === undefined) {
    fail(`could not parse ${exportName} array`);
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]!).filter(Boolean);
}

function extractTsRegexSource(source: string, exportName: string): string {
  const match = new RegExp(`export const ${exportName} =\\s*/(.+)/;`).exec(source);
  if (match?.[1] === undefined) {
    fail(`could not parse ${exportName} regex`);
  }
  return match[1];
}

const doc = parseYaml(fs.readFileSync(openapiPath, "utf8")) as Json;
const root = asRecord(doc, "openapi root");
if (root["openapi"] !== "3.1.0") {
  fail(`expected openapi 3.1.0, found ${String(root["openapi"])}`);
}

const paths = asRecord(root["paths"], "paths");
const components = asRecord(root["components"], "components");
const schemas = asRecord(components["schemas"], "components.schemas");

const operationIds: string[] = [];
for (const [pathKey, pathItemValue] of Object.entries(paths)) {
  const pathItem = asRecord(pathItemValue, `paths.${pathKey}`);
  for (const method of ["get", "post", "put", "patch", "delete", "head", "options", "trace"]) {
    const operationValue = pathItem[method];
    if (operationValue === undefined) {
      continue;
    }
    const operation = asRecord(operationValue, `paths.${pathKey}.${method}`);
    const operationId = operation["operationId"];
    if (typeof operationId !== "string" || operationId.length === 0) {
      fail(`missing operationId at paths.${pathKey}.${method}`);
    }
    operationIds.push(operationId);
  }
}

const unique = new Set(operationIds);
if (unique.size !== operationIds.length) {
  fail("duplicate operationId values detected");
}

const generated = fs.readFileSync(generatedPath, "utf8");
for (const operationId of operationIds) {
  if (!generated.includes(`${operationId}:`)) {
    fail(`generated types missing operationId ${operationId}`);
  }
}

const requiredSchemas = ["UuidV7", "Decimal", "BigInteger", "Problem", "Health"] as const;
for (const name of requiredSchemas) {
  if (!(name in schemas)) {
    fail(`components.schemas.${name} missing from OpenAPI`);
  }
  if (!generated.includes(`export type ${name} =`)) {
    fail(`generated types missing root export ${name}`);
  }
}

const uuidSchema = asRecord(schemas["UuidV7"], "UuidV7");
if (uuidSchema["type"] !== "string" || uuidSchema["format"] !== "uuid") {
  fail("UuidV7 must be string format uuid");
}
if (uuidSchema["pattern"] !== EXPECTED_UUID_V7) {
  fail("UuidV7 pattern drifted from expected OpenAPI pattern");
}

const decimalSchema = asRecord(schemas["Decimal"], "Decimal");
if (decimalSchema["type"] !== "string") {
  fail("Decimal must remain a string (never number)");
}
if (decimalSchema["pattern"] !== EXPECTED_DECIMAL) {
  fail("Decimal pattern drifted from expected OpenAPI pattern");
}

const bigIntegerSchema = asRecord(schemas["BigInteger"], "BigInteger");
if (bigIntegerSchema["type"] !== "string") {
  fail("BigInteger must remain a string (never number)");
}
if (bigIntegerSchema["pattern"] !== EXPECTED_BIG_INTEGER) {
  fail("BigInteger pattern drifted from expected OpenAPI pattern");
}

const problemSchema = asRecord(schemas["Problem"], "Problem");
const problemRequired = problemSchema["required"];
if (!Array.isArray(problemRequired)) {
  fail("Problem.required must be an array");
}
for (const field of EXPECTED_PROBLEM_FIELDS) {
  if (!problemRequired.includes(field)) {
    fail(`Problem missing RFC 9457 / contract required field: ${field}`);
  }
}
if (!generated.includes("application/problem+json")) {
  fail("generated types missing application/problem+json content type");
}

const streamPath = asRecord(paths["/tutor/runs/{runId}/events"], "stream path");
const streamGet = asRecord(streamPath["get"], "streamTutorRunEvents");
if (streamGet["operationId"] !== "streamTutorRunEvents") {
  fail("tutor SSE operationId must be streamTutorRunEvents");
}
const responses = asRecord(streamGet["responses"], "stream responses");
const ok = asRecord(responses["200"], "stream 200");
const content = asRecord(ok["content"], "stream 200 content");
if (!("text/event-stream" in content)) {
  fail("streamTutorRunEvents must declare text/event-stream");
}
if (!generated.includes('"text/event-stream"')) {
  fail("generated types missing text/event-stream for tutor SSE");
}

const primitivesSource = fs.readFileSync(primitivesPath, "utf8");
if (extractTsRegexSource(primitivesSource, "UUID_V7_PATTERN") !== EXPECTED_UUID_V7) {
  fail("api-schemas UUID_V7_PATTERN drifted from OpenAPI");
}
if (extractTsRegexSource(primitivesSource, "DECIMAL_PATTERN") !== EXPECTED_DECIMAL) {
  fail("api-schemas DECIMAL_PATTERN drifted from OpenAPI");
}
if (extractTsRegexSource(primitivesSource, "BIG_INTEGER_PATTERN") !== EXPECTED_BIG_INTEGER) {
  fail("api-schemas BIG_INTEGER_PATTERN drifted from OpenAPI");
}
const problemFields = extractTsStringArray(primitivesSource, "PROBLEM_REQUIRED_FIELDS");
if (problemFields.join(",") !== EXPECTED_PROBLEM_FIELDS.join(",")) {
  fail("api-schemas PROBLEM_REQUIRED_FIELDS drifted from OpenAPI");
}

const sseSource = fs.readFileSync(ssePath, "utf8");
const sseEvents = extractTsStringArray(sseSource, "TUTOR_SSE_EVENT_NAMES");
if (sseEvents.join(",") !== EXPECTED_SSE_EVENTS.join(",")) {
  fail("api-client TUTOR_SSE_EVENT_NAMES drifted from docs/API.md vocabulary");
}

console.log(
  `openapi:compat — ok (${operationIds.length} operationIds, Problem RFC 9457 fields, UuidV7/Decimal/BigInteger strings, SSE helpers)`,
);
