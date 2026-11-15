/**
 * Typed Product API client for web and mobile.
 *
 * Types come from `@deutsch-mate/api-schemas` (generated from `docs/openapi.yaml`).
 * Do not add handwritten DTO duplicates here.
 */

export { createProductApiClient, type ProductApiClient } from "./create-client.js";
export type { ClientOptions } from "openapi-fetch";

export {
  TUTOR_SSE_EVENT_NAMES,
  parseSseFrame,
  splitSseFrames,
  decodeTutorSseFrame,
  iterateTutorSseEvents,
  type TutorSseEventName,
  type TutorSseFrame,
  type TutorSseEvent,
  type TutorRunStartedData,
  type TutorMessageDeltaData,
  type TutorMessageCompletedData,
  type TutorRunTerminalData,
} from "./sse.js";
