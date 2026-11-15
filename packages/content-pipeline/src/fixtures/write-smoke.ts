import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeSmokeFixture } from "./build-smoke.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const out = writeSmokeFixture(repoRoot);
console.log(`Wrote smoke fixture to ${out}`);
