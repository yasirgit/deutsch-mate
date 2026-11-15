import createOpenApiFetchClient, { type ClientOptions } from "openapi-fetch";

import type { paths } from "@deutsch-mate/api-schemas";

export type ProductApiClient = ReturnType<typeof createProductApiClient>;

/**
 * Creates a typed Product API client bound to `docs/openapi.yaml` operation
 * IDs and path/schema types. Callers supply auth headers and a `/v1` base URL.
 */
export function createProductApiClient(options: ClientOptions) {
  return createOpenApiFetchClient<paths>(options);
}
