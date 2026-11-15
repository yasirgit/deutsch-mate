// Deliberate violations: a client app importing another app and a
// server-only package.
import "fixture-api";
import "ioredis";

export const clientViolations = true;
