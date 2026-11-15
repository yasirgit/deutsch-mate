/**
 * Thrown when process environment validation fails. Callers MUST treat this
 * as a fatal startup error (docs/CODING_STANDARDS.md §4, §13; NFR-005).
 */
export class ConfigValidationError extends Error {
  override readonly name = "ConfigValidationError";

  constructor(
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(message);
  }
}
