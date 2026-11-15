/**
 * CLI: export JSON Schema documents and validate `content/examples/` (DM-029).
 *
 * Invoked via root `pnpm content:schema`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { exportJsonSchemas } from "../json-schema.js";
import { ContentValidationError, validateContentDocument } from "../validate.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(packageRoot, "../..");
const schemaDir = path.join(repoRoot, "content/schema");
const examplesDir = path.join(repoRoot, "content/examples");

function writeJsonSchemas(): readonly string[] {
  fs.mkdirSync(schemaDir, { recursive: true });
  const written: string[] = [];
  for (const { fileName, schema } of exportJsonSchemas()) {
    const target = path.join(schemaDir, fileName);
    fs.writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
    written.push(path.relative(repoRoot, target));
  }
  return written;
}

function listExampleFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listExampleFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      results.push(full);
    }
  }
  return results.sort();
}

function validateExamples(): { readonly ok: number; readonly failures: readonly string[] } {
  const files = listExampleFiles(examplesDir);
  const failures: string[] = [];
  let ok = 0;
  for (const file of files) {
    const relative = path.relative(repoRoot, file);
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed: unknown = JSON.parse(raw);
      validateContentDocument(parsed);
      ok += 1;
    } catch (error) {
      if (error instanceof ContentValidationError) {
        failures.push(`${relative}: ${error.issues.join("; ")}`);
      } else if (error instanceof SyntaxError) {
        failures.push(`${relative}: invalid JSON (${error.message})`);
      } else if (error instanceof Error) {
        failures.push(`${relative}: ${error.message}`);
      } else {
        failures.push(`${relative}: unknown validation failure`);
      }
    }
  }
  return { ok, failures };
}

const written = writeJsonSchemas();
console.log(`content:schema wrote ${written.length} JSON Schema file(s) under content/schema/`);

const { ok, failures } = validateExamples();
if (failures.length > 0) {
  console.error(`content:schema failed ${failures.length} example(s):`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

const exampleCount = listExampleFiles(examplesDir).length;
if (exampleCount === 0) {
  console.error("content:schema found no JSON examples under content/examples/");
  process.exit(1);
}

console.log(`content:schema validated ${ok}/${exampleCount} example(s)`);
