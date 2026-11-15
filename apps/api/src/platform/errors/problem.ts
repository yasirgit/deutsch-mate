/**
 * RFC 9457 Problem Details helpers aligned with docs/API.md / openapi.yaml.
 */

export const PROBLEM_TYPE_BASE = "https://api.deutschmate.example/problems";

export type ProblemCode =
  | "validation_failed"
  | "authentication_required"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "etag_mismatch"
  | "idempotency_conflict"
  | "entitlement_required"
  | "rate_limited"
  | "dependency_unavailable"
  | "precondition_required"
  | "publication_validation_failed"
  | "internal_error";

export interface ProblemFieldError {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly requestId: string;
  readonly code: ProblemCode | string;
  readonly errors?: readonly ProblemFieldError[];
}

const TITLES: Record<ProblemCode, string> = {
  validation_failed: "Validation failed",
  authentication_required: "Authentication required",
  forbidden: "Forbidden",
  not_found: "Not found",
  conflict: "Conflict",
  etag_mismatch: "ETag mismatch",
  idempotency_conflict: "Idempotency conflict",
  entitlement_required: "Entitlement required",
  rate_limited: "Rate limited",
  dependency_unavailable: "Dependency unavailable",
  precondition_required: "Precondition required",
  publication_validation_failed: "Publication validation failed",
  internal_error: "Internal error",
};

export function problemTypeForCode(code: string): string {
  return `${PROBLEM_TYPE_BASE}/${code.replace(/_/g, "-")}`;
}

export function titleForCode(code: string): string {
  if (code in TITLES) {
    return TITLES[code as ProblemCode];
  }
  return "Error";
}

export function buildProblem(input: {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly instance: string;
  readonly requestId: string;
  readonly errors?: readonly ProblemFieldError[];
}): ProblemDetails {
  const problem: ProblemDetails = {
    type: problemTypeForCode(input.code),
    title: titleForCode(input.code),
    status: input.status,
    detail: input.detail,
    instance: input.instance,
    requestId: input.requestId,
    code: input.code,
  };
  if (input.errors !== undefined && input.errors.length > 0) {
    return { ...problem, errors: input.errors };
  }
  return problem;
}
