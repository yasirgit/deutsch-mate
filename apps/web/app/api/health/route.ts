/**
 * Web-app health endpoint matching the `Health` schema shape in
 * `docs/openapi.yaml` ({ status, checkedAt }).
 */
export function GET(): Response {
  return Response.json({ status: "ok", checkedAt: new Date().toISOString() });
}
