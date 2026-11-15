/**
 * Contract facade for bootstrap-era imports.
 *
 * DM-025 owns generation in dedicated packages:
 * - `@deutsch-mate/api-schemas` — OpenAPI-generated types + primitive validators
 * - `@deutsch-mate/api-client` — typed fetch client + tutor SSE helpers
 *
 * Prefer importing those packages directly in new code. This package re-exports
 * their public surface so existing `@deutsch-mate/contracts` imports keep working.
 */

export type * from "@deutsch-mate/api-schemas";
export {
  UUID_V7_PATTERN,
  DECIMAL_PATTERN,
  BIG_INTEGER_PATTERN,
  PROBLEM_REQUIRED_FIELDS,
  isUuidV7,
  isDecimalString,
  isBigIntegerString,
  isProblemDetails,
} from "@deutsch-mate/api-schemas";

export {
  createProductApiClient,
  TUTOR_SSE_EVENT_NAMES,
  parseSseFrame,
  splitSseFrames,
  decodeTutorSseFrame,
  iterateTutorSseEvents,
} from "@deutsch-mate/api-client";
export type {
  ProductApiClient,
  ClientOptions,
  TutorSseEventName,
  TutorSseFrame,
  TutorSseEvent,
  TutorRunStartedData,
  TutorMessageDeltaData,
  TutorMessageCompletedData,
  TutorRunTerminalData,
} from "@deutsch-mate/api-client";
