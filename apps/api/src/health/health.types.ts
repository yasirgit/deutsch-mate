/**
 * Matches the `Health` schema in `docs/openapi.yaml`.
 */
export interface HealthStatus {
  readonly status: "ok";
  readonly checkedAt: string;
}
