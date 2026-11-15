/**
 * Global exception filter: RFC 9457 `application/problem+json`.
 * Never leaks stacks, SQL, secrets, provider messages, or internal hashes.
 */

import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

import { getRequestId } from "../request-context.js";
import { buildProblem, type ProblemCode, type ProblemFieldError } from "./problem.js";

const SENSITIVE_DETAIL =
  /\b(stack|sql|select |insert |update |delete |password|secret|token|authorization|postgres|econnrefused|openai|stripe)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeDetail(candidate: string, fallback: string): string {
  if (candidate.length === 0 || SENSITIVE_DETAIL.test(candidate)) {
    return fallback;
  }
  if (candidate.length > 500) {
    return fallback;
  }
  return candidate;
}

function mapStatusToCode(status: number, explicit?: string): string {
  if (explicit && /^[a-z][a-z0-9_]*$/.test(explicit)) {
    return explicit;
  }
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "validation_failed";
    case HttpStatus.UNAUTHORIZED:
      return "authentication_required";
    case HttpStatus.FORBIDDEN:
      return "forbidden";
    case HttpStatus.NOT_FOUND:
      return "not_found";
    case HttpStatus.CONFLICT:
      return "conflict";
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return "publication_validation_failed";
    case HttpStatus.PRECONDITION_REQUIRED:
      return "precondition_required";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "rate_limited";
    case HttpStatus.SERVICE_UNAVAILABLE:
      return "dependency_unavailable";
    default:
      return status >= 500 ? "internal_error" : "validation_failed";
  }
}

function extractFieldErrors(value: unknown): readonly ProblemFieldError[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const errors: ProblemFieldError[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const path = item["path"];
    const code = item["code"];
    const message = item["message"];
    if (typeof path === "string" && typeof code === "string" && typeof message === "string") {
      errors.push({ path, code, message });
    }
  }
  return errors.length > 0 ? errors : undefined;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{
      originalUrl?: string;
      url?: string;
      headers?: Record<string, string | string[] | undefined>;
    }>();

    const requestId =
      getRequestId() ??
      (typeof response.getHeader === "function"
        ? String(response.getHeader("x-request-id") ?? "") || "00000000-0000-7000-8000-000000000000"
        : "00000000-0000-7000-8000-000000000000");

    const instance = request.originalUrl ?? request.url ?? "/v1";

    let status: number;
    let code: string;
    let detail: string;
    let errors: readonly ProblemFieldError[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        detail = safeDetail(body, detailForStatus(status));
        code = mapStatusToCode(status);
      } else if (isRecord(body)) {
        const explicitCode = typeof body["code"] === "string" ? body["code"] : undefined;
        code = mapStatusToCode(status, explicitCode);
        const rawDetail =
          typeof body["detail"] === "string"
            ? body["detail"]
            : typeof body["message"] === "string"
              ? body["message"]
              : Array.isArray(body["message"])
                ? "One or more fields are invalid."
                : detailForStatus(status);
        detail = safeDetail(rawDetail, detailForStatus(status));
        errors = extractFieldErrors(body["errors"]);

        // class-validator ValidationPipe default shape
        if (Array.isArray(body["message"]) && (errors === undefined || errors.length === 0)) {
          const fieldErrors: ProblemFieldError[] = [];
          for (const msg of body["message"]) {
            if (typeof msg === "string") {
              fieldErrors.push({
                path: "/",
                code: "invalid",
                message: safeDetail(msg, "Invalid value."),
              });
            }
          }
          if (fieldErrors.length > 0) {
            errors = fieldErrors;
            code = "validation_failed";
            detail = "One or more fields are invalid.";
          }
        }
      } else {
        code = mapStatusToCode(status);
        detail = detailForStatus(status);
      }
    } else {
      this.logger.error(
        "Unhandled exception",
        exception instanceof Error ? exception.stack : String(exception),
      );
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      code = "internal_error";
      detail = "An unexpected error occurred.";
    }

    if (!response.getHeader("x-request-id")) {
      response.setHeader("X-Request-Id", requestId);
    }

    const problem = buildProblem({
      status,
      code: code as ProblemCode,
      detail,
      instance,
      requestId,
      ...(errors !== undefined ? { errors } : {}),
    });

    response.status(status).type("application/problem+json").json(problem);
  }
}

function detailForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "One or more fields are invalid.";
    case HttpStatus.UNAUTHORIZED:
      return "Authentication is required.";
    case HttpStatus.FORBIDDEN:
      return "Access is denied.";
    case HttpStatus.NOT_FOUND:
      return "Resource was not found.";
    case HttpStatus.CONFLICT:
      return "The request conflicts with the current state.";
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return "Publication validation failed.";
    case HttpStatus.PRECONDITION_REQUIRED:
      return "If-Match is required.";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "Rate limit exceeded.";
    case HttpStatus.SERVICE_UNAVAILABLE:
      return "A required dependency is unavailable.";
    default:
      return "An unexpected error occurred.";
  }
}
