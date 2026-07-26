# Deutsch Mate MVP API Contract

**Status:** production implementation baseline  
**Machine contract:** `docs/openapi.yaml` (OpenAPI 3.1)  
**Authorities:** `docs/architecture.md`, then `docs/MVP_SCOPE.md`, then `docs/PRD.md`, then `docs/Database.md`

## 1. Boundary and conventions

The NestJS Product API is a versioned REST API at `/v1`. It is the only client-facing gateway to product data, LangGraph workflows, and Stripe-backed billing. Clients never call model providers or read provider payloads, internal hashes, S3 keys, audit metadata, or another user's identifiers.

- JSON uses UTF-8 and `camelCase`; persisted `snake_case` fields map one-for-one by meaning.
- Timestamps are RFC 3339 UTC strings. UUIDs are UUIDv7. Money is integer `amountMinor` plus uppercase ISO-4217 `currency`.
- Numeric PostgreSQL values are JSON strings (`score`, `maxScore`, ratios, weights, interval/ease); PostgreSQL `bigint` values are decimal strings.
- Unknown request properties are rejected. Nullable persistence columns are omitted unless their absence is meaningful; the contract marks nullable values explicitly.
- Successful creation returns `201`; accepted asynchronous work returns `202`; commands with no body return `204`.
- The API never claims certification. MVP progress exposes skill- and objective-level evidence with `disclaimerCode=cefr_estimate_not_certificate`; it does not expose an overall level estimate.

### Authentication and authorization

Cognito exposes OAuth 2.0 Authorization Code with PKCE and OIDC. The API validates issuer, audience, signature, expiry, and scopes on every bearer token. The token subject is resolved through `iam.user_identities`; request bodies never select the acting user.

Scopes are `profile:read`, `profile:write`, `learning:read`, `learning:write`, `tutor:use`, `billing:read`, `billing:write`, `privacy:read`, `privacy:write`, `support:write`, `content:write`, `content:review`, and `ai:release`. Active database roles provide a second authorization check:

- `learner`: self-owned profile, learning, AI, billing, privacy, and support resources.
- `content_editor`: draft content and AI version creation.
- `content_reviewer`: approval/rejection.
- `support`, `privacy_operator`, `billing_operator`: purpose-limited operational access; no general cross-domain access.
- `admin`: privileged operations but never an RLS bypass.

Public operations are health, published plans, and the Stripe webhook. Published curriculum still requires authentication so entitlement filtering and progress can be applied.

### Headers and errors

Every response contains `X-Request-Id`; a valid client-supplied UUID in `X-Request-Id` is propagated, otherwise the edge creates one. It becomes the database correlation ID and propagates through outbox, workers, AI calls, and logs. Responses include `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` on `429`.

Errors use `application/problem+json` (RFC 9457): `type`, `title`, `status`, `detail`, `instance`, `requestId`, stable `code`, and optional field `errors`. No stack, provider message, secret, or learner content is returned. Important codes include `validation_failed`, `authentication_required`, `forbidden`, `not_found`, `conflict`, `etag_mismatch`, `idempotency_conflict`, `entitlement_required`, `rate_limited`, `dependency_unavailable`, and `internal_error`.

`Idempotency-Key` (1-128 visible ASCII characters) is required on every operation marked with the reusable `IdempotencyKey` parameter in `docs/openapi.yaml`; the machine contract is authoritative. These operations include state-changing profile, consent, onboarding, learning, AI, billing, privacy, support, and governed release commands. The server hashes the canonical request. Same actor/scope/key and same hash replays the original status/body; a changed hash returns `409 idempotency_conflict`. Attempt and checkout results are retained 400 days; other commands 24 hours. `clientAttemptId` and `clientMessageId` provide domain-level deduplication.

Mutable resources return a strong ETag derived from `lockVersion` (for example `"3"`). Updates require `If-Match`; stale versions return `409 etag_mismatch`. Immutable versions use content-based ETags and support `If-None-Match`/`304`. A mutation never accepts `lockVersion` in its body.

Collections use opaque cursor pagination: `?limit=20&cursor=...`, maximum 100. Responses contain `items` and `page.nextCursor` (nullable) with stable ordering documented per operation. Clients must not decode cursors.

## 2. End-to-end flows

### Account, consent, and onboarding

1. Cognito completes OIDC authentication; `GET /v1/me` resolves or provisions the product user (`FR-001`).
2. `GET /v1/me/consents/requirements` returns current legal versions. `POST /v1/me/consents` appends one event per required document or optional marketing purpose (`FR-002`).
3. `PATCH /v1/me` updates `interfaceLocale` under `If-Match`; `PUT /v1/me/profile` appends the next `learner.profile_versions` row. Both interfaces map to `FR-003`, and profile history is never rewritten.
4. `PATCH /v1/me/onboarding` persists `stepCode`, completed steps, and optional recommendation. `POST /v1/me/onboarding/complete` validates required consent/profile state and returns the first unit (`FR-010`).
5. Account deletion uses the privacy delete workflow; it is not an immediate row deletion (`FR-001`, `FR-070`).

### Curriculum, lessons, sessions, attempts, review, and progress

1. `GET /v1/curriculum/releases/current`, level modules, units, and lessons expose only a published immutable release and exact version IDs (`FR-020`–`FR-023`, `FR-050`). Listening activities expose only approved client-safe asset metadata—an opaque media registry ID or short-lived purpose-bound download URL, never a bucket or object key. Curriculum objectives expose their reviewed CEFR descriptor mappings and source/version metadata as alignment evidence, not certification.
2. `POST /v1/learning/sessions` pins release, unit, optional lesson, platform, and creates an active resumable session (`FR-021`).
3. `POST /v1/learning/sessions/{sessionId}/attempts` requires both `Idempotency-Key` and UUIDv7 `clientAttemptId`. In one transaction deterministic work inserts attempt/response, score/evidence, review/progress projections, and outbox events. Writing creates `feedback_pending` plus an AI run (`FR-021`–`FR-024`, `FR-050`, `NFR-012`).
4. `GET /v1/learning/attempts/{attemptId}` polls the durable derived state. Failed/unverified writing returns `feedback_unavailable` and no valid mastery evidence (`FR-024`).
5. `GET /v1/learning/review-items` lists due/scheduled projection rows. `POST /v1/learning/recommendations` records an immutable reproducibility snapshot and returns lesson, review, or upgrade (`FR-030`, `FR-031`).
6. `GET /v1/learning/progress` separates unit completion from proficiency evidence and includes evidence date and disclaimer (`FR-032`, `FR-052`).

### Tutor streaming

1. `POST /v1/tutor/runs` checks `tutor_chat` entitlement/allowance, creates or resumes a user-owned thread, creates a queued run, and returns `runId`, `threadId`, `statusUrl`, and a short-lived `streamUrl` (`FR-040`, `FR-041`).
2. The client opens `GET /v1/tutor/runs/{runId}/events` with `Accept: text/event-stream` and bearer authorization. OpenAPI documents the operation but cannot model event sequencing completely.
3. SSE frames have `id`, `event`, and JSON `data`. Events are `run.started`, `message.delta`, `message.completed`, `run.blocked`, `run.failed`, and `run.completed`; heartbeat comments may occur. `Last-Event-ID` resumes while fragments remain available. Deltas are not evidence. The latency objective measures time to the first verified learner-visible `message.delta`, never a raw provider token. The final disposition and trace are durable before `run.completed`.
4. `GET /v1/tutor/runs/{runId}` is the authoritative recovery/polling path after disconnect. Retry with the same idempotency key and `clientMessageId` never creates duplicate durable actions.

### Writing feedback

Submitting a writing activity through the attempt endpoint creates the attempt and writing job atomically. `GET /v1/writing-feedback/jobs/{attemptId}` returns `queued|running|succeeded|blocked|failed|timed_out|cancelled`, verifier result, and released feedback when available. Raw writing/correction expires after 90 days. A failed verifier yields unavailable feedback and invalid/unverified evidence, never mastery (`FR-024`).

### Billing and entitlement

1. `GET /v1/billing/plans` returns active Free/Premium plans, effective Stripe prices, taxes, recurring terms, and server-configured feature limits (`FR-060`, `FR-063`).
2. `POST /v1/billing/checkout-sessions` accepts an internal `planPriceId` and allowlisted return URLs. The server creates a Stripe **Checkout Session in `subscription` mode**. It never specifies `payment_method_types`; Stripe Dashboard/payment-method configuration decides eligibility (`FR-061`).
3. Redirect completion is not proof of access. `POST /v1/webhooks/stripe` verifies `Stripe-Signature` over the exact raw body before JSON parsing, then inserts the provider event ID once and processes asynchronously/idempotently. Reordered events compare provider creation time and refresh ambiguous objects. Subscription and entitlement changes are transactional (`FR-061`, `NFR-012`).
4. `GET /v1/billing/subscription` and `/entitlements` read PostgreSQL, never Stripe synchronously. `POST /v1/billing/customer-portal-sessions` creates a Stripe Customer Portal URL for billing management (`FR-062`).

The Stripe SDK/API version is pinned to `2026-05-27.dahlia`. Development, staging, and production use different least-privilege Stripe restricted keys loaded at runtime from AWS Secrets Manager; keys never enter source, logs, clients, database snapshots, or API schemas. The webhook signing secret is separately scoped and rotated. No card data is stored.

### Privacy and support

`POST /v1/privacy/requests` creates `export` or `delete` work after high-assurance identity confirmation; `GET` endpoints expose durable status, due date, retention exceptions, and a short-lived export download URL only after completion (`FR-070`). Delete immediately moves the account to `deletion_pending`, revokes sessions, and enqueues erasure; legal retention can yield `partially_retained`.

`POST /v1/support/cases` accepts account, learning, privacy, or billing cases and optional `aiRunId`; list/detail operations are owner-scoped. Staff assignment/notes are intentionally not part of the learner MVP contract (`FR-071`).

### Protected content and AI releases

Governed repository import/release scripts create protected immutable curriculum, prompt, rubric, and model-configuration versions. The protected API handles review, publication, and selection of a prior approved version for rollback (`FR-072`); its release-creation commands register already versioned governed imports rather than accepting learner-authored content. Content operations cover curriculum releases; AI operations cover prompt/model routing releases. `content_editor` cannot self-approve. Human review submits `submitted`, `approved`, `rejected`, `retired`, or `rollback_selected`; the `published` review event and publication actor/timestamp are generated by the server only after successful publication. Publication uses serializable bounded retry and validates the complete content manifest. Learner routes never expose drafts.

## 3. Operation-to-requirement map

| Operations | PRD requirements |
|---|---|
| `getCurrentUser`, `updateCurrentUser`, `getConsentRequirements`, `recordConsentEvents`, `get/updateCurrentProfile`, onboarding operations | FR-001, FR-002, FR-003, FR-010 |
| curriculum release/module/unit/lesson reads | FR-020, FR-021, FR-022, FR-023, FR-050, FR-052 |
| `createLearningSession`, `get/updateLearningSession`, `submitActivityAttempt`, `getActivityAttempt` | FR-021, FR-022, FR-023, FR-024, FR-050 |
| review, recommendation, and progress operations | FR-030, FR-031, FR-032, FR-052 |
| tutor initiation, SSE, and run status | FR-040, FR-041 |
| writing feedback job | FR-024 |
| plans, checkout, portal, subscription, entitlements, Stripe webhook | FR-060, FR-061, FR-062, FR-063 |
| privacy request operations | FR-001, FR-002, FR-070 |
| support case operations | FR-071 |
| content/AI version and release operations | FR-020, FR-041, FR-072 |

All operations also implement applicable NFR-001–016, especially security (NFR-005), privacy (NFR-006), AI traceability/quality (NFR-007–008), generated-client compatibility (NFR-010), correlation (NFR-011), idempotency (NFR-012), immutable versions (NFR-014), and NestJS/TypeScript maintainability (NFR-015).

## 4. NestJS implementation rules

- Generate DTOs/types from `openapi.yaml`; enable global validation with transformation disabled for unknown fields and a consistent Problem Details exception filter.
- Authentication guard verifies OIDC; scope guard and active-role lookup authorize; repositories set transaction-local `app.user_id`, `app.roles`, and `app.correlation_id`.
- Preserve the raw body only on the Stripe webhook route. Reject an absent/invalid signature before parsing or persisting.
- Product request handlers call capability services; they do not write another module's tables. Cross-module writes and outbox insertions share one PostgreSQL transaction.
- Log operation ID, status, duration, actor pseudonym, and request ID—not tokens, email, raw tutor/writing, Stripe payloads, signed URLs, or Problem `detail`.
- Contract tests must verify every documented status/content type/header, authorization isolation, idempotent replay/conflict, stale ETags, cursor behavior, and provider/AI failure states.
