# Deutsch Mate Coding Standards

**Status:** normative implementation standard  
**Applies to:** all application, worker, package, test, migration, infrastructure, and automation code  
**Authorities:** `docs/architecture.md`, `docs/MVP_SCOPE.md`, `docs/PRD.md`, `docs/Database.md`, `docs/API.md`, `docs/openapi.yaml`, `docs/AI_AGENTS.md`

## 1. Normative language and enforcement

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative. A `MUST` exception requires a time-bounded, owner-named waiver in the pull request and approval from the relevant security, privacy, data, or architecture owner. CI, review, and release evidence enforce this document; local success alone is not sufficient.

Repository manifests and lockfiles are the version authority. Use active LTS runtime/tool lines and pin them in `.nvmrc` or equivalent, `package.json` `engines` and `packageManager`, `pnpm-lock.yaml`, workspace manifests, and infrastructure images. Do not copy speculative version numbers into documentation or use unpinned `latest` tags. Upgrades require a dedicated, tested pull request.

## 2. Repository and build system

- Use a `pnpm` workspace managed by Turborepo. `pnpm-lock.yaml` is committed and CI uses a frozen lockfile.
- Applications belong under `apps/`; reusable packages belong under `packages/`; infrastructure, scripts, and explicit SQL migrations use named top-level directories established by the repository.
- Each package declares its own dependencies and scripts. Importing an undeclared transitive dependency is forbidden.
- Turborepo tasks MUST declare inputs, outputs, environment variables, cache behavior, and dependencies accurately. Tasks that use secrets, mutable remote state, clocks, or external providers MUST NOT be remotely cached unless their output is demonstrably safe and deterministic.
- The root provides canonical `format`, `lint`, `typecheck`, `test`, `build`, contract, migration, dependency, and security commands. Packages MUST participate through Turborepo rather than replacing root policy.
- Build artifacts, generated clients, coverage, local secrets, and tool caches are not hand-edited. Commit generated artifacts only when the repository explicitly designates them as reviewable source.
- Production code MUST run on the repository-pinned active LTS versions. Developer tools MUST use the pinned package-manager and runtime versions.

## 3. TypeScript baseline

- Enable `strict` and the strongest practical compiler checks, including unchecked indexed access, exact optional properties, override checks, and consistent file-name casing. A package MUST NOT weaken the shared configuration.
- `any`, `@ts-ignore`, non-null assertions, and unsafe double casts are forbidden in product code. A narrow adapter may use `unknown` plus validation; any suppression requires a reason and issue reference.
- Prefer immutable inputs and outputs: `readonly`, discriminated unions, exhaustive `never` checks, and small explicit interfaces.
- Do not use TypeScript numeric enums. Use string literal unions or `as const` maps that match runtime and wire values.
- Use `unknown` at trust boundaries. Narrow with a runtime schema before business logic.
- Distinguish absence from `null` according to the OpenAPI/database contract. Do not use truthiness where `0`, `false`, or an empty string is valid.
- Represent money as `bigint` minor units plus uppercase ISO-4217 currency. Represent PostgreSQL `numeric` as decimal strings or an approved decimal type; never use JavaScript floating point for money or exact scores.
- Use RFC 3339 UTC strings at API boundaries and `timestamptz` in PostgreSQL. Parse dates once at boundaries; do not rely on host locale or implicit time zones.
- Use the shared UUIDv7 generator and validator. IDs are opaque and MUST NOT encode personal data.
- Public package APIs and exported domain types require explicit return types. Inferred local types are preferred when unambiguous.

## 4. Runtime schemas and contracts

- Every external input, environment variable, configuration document, queue payload, persisted JSON shape, AI state/output, and provider response MUST have a strict runtime schema.
- The approved schema library is the repository-pinned one; Zod is the current architectural baseline. Infer TypeScript types from the runtime schema when it is the source of truth.
- Reject unknown keys at security and business boundaries. Transformation/coercion MUST be explicit and tested.
- A schema change that affects a wire, event, checkpoint, content, rubric, or stored JSON contract requires a version and backward-compatibility plan.
- Validate once at ingress and keep validated domain values distinct from raw transport values.
- OpenAPI is the client-facing contract. Generated web and mobile clients/types MUST come from `docs/openapi.yaml`; do not maintain handwritten duplicate DTOs.
- Generated code is regenerated through a pinned command and MUST pass a clean-tree drift check in CI.

## 5. Module and dependency boundaries

- The NestJS Product API is a modular monolith. Capability modules own their domain services, repositories, schemas, database schema, and events.
- A module MUST NOT import another module's repository, write another capability's tables, or reach through its internals. Use an exported application service for synchronous in-process work or a versioned domain event for cross-process work.
- Cross-module writes that require one consistency boundary go through owning services in one PostgreSQL transaction.
- Controllers and queue consumers are adapters: authenticate/validate, call one or more application services, and map the result. They MUST NOT contain domain rules or direct SQL.
- Domain/application code MUST NOT import NestJS, Next.js, React Native, OpenAI, Stripe, AWS SDK, `pg`, or transport-specific DTOs. Adapters implement domain-owned ports.
- Shared packages are allowed for contracts, runtime schemas, observability, test fixtures, and narrowly stable primitives. A generic `common`, `utils`, or dumping-ground package is forbidden.
- Web and mobile MUST NOT import server modules or database types. They consume generated API clients and client-safe shared packages only.
- Graph nodes MUST call typed, allowlisted tools or application ports; they MUST NOT access arbitrary repositories, networks, files, environment variables, or another module's tables.
- Dependency cycles are forbidden and checked in CI. New cross-package edges require reviewer justification.

## 6. Naming and file layout

- TypeScript files use `kebab-case.ts`; React components use `PascalCase.tsx` only where the platform tooling convention requires it. Tests use `.test.ts`, `.integration.test.ts`, `.contract.test.ts`, `.e2e.test.ts`, or `.eval.test.ts`.
- Types, classes, components, and runtime schemas use `PascalCase`; values and functions use `camelCase`; constants use `UPPER_SNAKE_CASE` only for true process-wide constants.
- Boolean names begin with `is`, `has`, `can`, `should`, or another clear predicate. Collections are plural. Include units in names such as `timeoutMs`, `amountMinor`, and `sizeBytes`.
- Database identifiers are `snake_case`; JSON/API fields are `camelCase`. Mapping is explicit and meaning-preserving.
- Stable external identifiers use documented naming: OpenAPI `operationId` is verb-led camelCase; event types use stable dotted past-tense names; error and reason codes use `snake_case`; configuration keys use a documented stable convention.
- Do not use vague names such as `data`, `item`, `manager`, `helper`, or `process` where a domain term exists.
- One file has one primary responsibility. Barrel exports MAY exist only at package/module public boundaries and MUST NOT hide cycles or side effects.

## 7. Functions, state, and side effects

- Functions SHOULD be small, deterministic, and single-purpose. Separate calculation from I/O.
- Mutable module-level state is forbidden. Request, transaction, graph, and job state must be explicit.
- Side effects require an idempotency identity when retried delivery is possible.
- Do not silently swallow errors, return sentinel values for exceptional states, or start unawaited promises. Intentionally detached work must be owned by a durable queue or lifecycle manager and tested.
- Use dependency injection at process boundaries. Time, randomness, UUID generation, and provider calls must be controllable in tests.
- Comments explain invariants and reasons, not line-by-line mechanics. Delete stale code instead of commenting it out.

## 8. Error handling

- Use typed domain/application errors with stable `code`, safe message, retry classification, and optional structured metadata. Preserve causes internally.
- REST errors conform to RFC 9457 `application/problem+json` and `docs/API.md`. Never expose stack traces, SQL, provider bodies/messages, secrets, internal hashes, or learner content.
- Map validation, authentication, authorization, not-found, conflict, precondition, rate, dependency, and internal failures consistently. Hide cross-user resource existence with the contractually required not-found behavior.
- Retry only classified transient failures, with bounded attempts, exponential backoff, full jitter, deadline awareness, and idempotent effects. Do not retry validation, authorization, safety blocks, budget denial, or deterministic conflicts.
- Every async workflow has explicit terminal states. Timeouts, cancellations, malformed AI output, and exhausted retries MUST produce safe, durable outcomes and MUST NOT fabricate learning evidence.
- Log an error once at the boundary that owns recovery or response mapping. Lower layers add typed context and rethrow; they do not duplicate noisy logs.

## 9. API and client patterns

- The NestJS Product API is the only client gateway. Clients MUST NOT call OpenAI, Stripe APIs, S3 object keys, databases, or workers directly.
- Follow `/v1`, JSON, status, header, pagination, ETag, idempotency, UUIDv7, decimal-string, bigint-string, and Problem Details rules in `docs/API.md` and `docs/openapi.yaml`.
- Authentication establishes the actor. A request body/path parameter MUST NOT choose the acting user. Every user-owned operation enforces scope, active role where applicable, ownership, and entitlement server-side.
- Mutating commands named by the API contract require `Idempotency-Key`; canonical request hashing and replay/conflict behavior are mandatory.
- Mutable resources use strong ETags and `If-Match`. Collections use opaque cursor pagination with stable ordering.
- SSE is limited to the documented tutor event contract. Persist terminal state before completion, use monotonic event IDs, support bounded resume, and treat deltas as non-authoritative.
- OpenAPI changes are contract-first. The same pull request updates the specification, generated clients, server implementation, contract tests, and compatibility notes.
- Breaking changes require a new API/event/schema version and migration/deprecation plan; they are not hidden in an existing version.
- Next.js server/client boundaries MUST be explicit. Secrets and privileged server code MUST NOT enter client bundles.
- React Native native capabilities use reviewed adapters. Tokens use platform-secure storage; general application storage MUST NOT contain access tokens or sensitive learner content.

## 10. Database and migration patterns

- PostgreSQL is the source of truth. Use Kysely over `node-postgres` for typed queries and transactions. Raw SQL is allowed when needed for PostgreSQL behavior, but it MUST be parameterized, localized, reviewed, and tested.
- Kysely types are persistence adapters, not domain or API contracts. Query-critical data uses columns; `jsonb` is limited to strict validated snapshots/provider payloads.
- Schema changes use explicit, forward-only SQL migration files. ORM/schema auto-sync, `db push`, runtime DDL, and production schema inference are forbidden, including local workflows that can drift from CI.
- Migrations MUST follow `docs/Database.md`: expand/contract, bounded backfills, lock/statement timeouts, concurrent indexes where required, `NOT VALID` then validation for large constraints, and one-release compatibility.
- CI MUST build the database from empty and upgrade a production-shaped previous snapshot. Destructive changes require a later cleanup release, restore/rollback strategy, and evidence that old application code remains safe during rollout.
- All queries are parameterized. Dynamic identifiers come only from closed allowlists. N+1 queries and unbounded reads are forbidden.
- Transactions are short and own a business consistency boundary. Do not hold a transaction open across OpenAI, Stripe, S3, Redis, or queue calls.
- Use `READ COMMITTED` by default, explicit row locks for aggregate changes, and `SERIALIZABLE` with bounded retry only where the database contract requires it.
- Set transaction-local user, roles, and correlation context. Runtime roles never bypass RLS. Every user-owned table/view has positive and negative cross-user tests.
- Respect UUIDv7, UTC, bigint/numeric, immutability, append-only evidence, optimistic locking, foreign-key, index, and capability-schema rules in `docs/Database.md`.
- Corrections append a superseding fact/version. Published content, attempts, scores, evidence, release history, and audit records are never rewritten.

## 11. Events, queues, Redis, and S3

- Cross-process events originate in the same PostgreSQL transaction as the business mutation through the transactional outbox.
- Events have stable names, an explicit integer version, runtime schema, correlation/causation IDs, aggregate identity, and minimal payload. Consumers reject or quarantine unsupported versions.
- Delivery is at least once. Consumers use the PostgreSQL inbox, domain uniqueness, and atomic side effects for one effective outcome. Retries are bounded; poison messages enter a DLQ with replay tooling and alerts.
- EventBridge routes events; SQS buffers work. Do not use queues as an untracked database or rely on ordering unless the queue/consumer contract explicitly provides it.
- Redis stores only reconstructable or expendable state with environment-prefixed keys, schema-versioned values, TTLs, and workload ACLs. Redis loss MUST NOT lose attempts, results, entitlements, subscriptions, graph checkpoints, or terminal AI outcomes.
- Redis MUST NOT hold raw chat, writing, email, credentials, tokens, Stripe payloads, or signed URLs.
- S3 objects are private, encrypted, versioned, checksummed, registered in PostgreSQL, and accessed with short-lived purpose-bound presigned URLs. Object keys contain no direct identifiers.
- Uploads enforce exact key, MIME allowlist, size, checksum, malware/quarantine, and lifecycle policy. Immutable evidence/audit objects follow Object Lock and retention rules.

## 12. AI and LangGraph.js patterns

- All model calls go through the internal AI gateway. Provider SDKs and credentials are confined to that adapter.
- Graphs are compiled from a closed registry, use strict runtime state, bounded steps/loops, typed reducers, pinned releases/policies, and PostgreSQL checkpoints. Redis may cache but is never authoritative.
- Prompts, model configurations, output schemas, tools, safety policies, budgets, rubrics, and graph code versions are immutable and traceable for each run.
- Untrusted learner/content text remains typed data and never becomes system authority. No dynamic tools, arbitrary retrieval, browser, shell, SQL generation/execution, unrestricted URLs, or code execution.
- Context assembly uses purpose-specific bounded queries, row ownership, released-content checks, PII minimization, stable ordering, and source/version manifests.
- Model output uses strict structured output, local semantic validation, and required independent verification. Unknown fields and unverifiable output fail closed.
- AI output does not create mastery by default. Only an immutable approved rubric/algorithm may make verified output evidence-eligible.
- Every run records feature, graph, prompt, model, verifier and policy versions, sources/tools, latency, tokens, estimated cost, result, and disposition without putting unrestricted content in standard telemetry.
- Prompt/model/graph/policy changes require frozen teacher-labeled regression evaluation, privacy/security checks, controlled rollout, kill switch, and approved rollback target. Gates in `docs/MVP_SCOPE.md` and `docs/AI_AGENTS.md` are release-blocking.
- Deterministic learning MUST remain usable when AI is unavailable.

## 13. Security, privacy, and logging

- Apply least privilege, deny-by-default authorization, TLS, encryption at rest, Secrets Manager/KMS, workload identity, short-lived tokens, secure client storage, input/output encoding, rate limits, and WAF controls.
- Secrets MUST NOT be committed, copied into images, passed through client-visible environment variables, stored in database snapshots, or logged. Secret scanning is mandatory.
- Validate OIDC issuer, audience, signature, expiry, scopes, and PKCE flow. Authorization requires both application capability and ownership/active role; `admin` is not an RLS bypass.
- Treat learner writing, chat, audio, transcripts, support descriptions, identity, billing metadata, and AI traces according to the data inventory and retention policy. Collect and send only what the active purpose requires.
- Standard logs, spans, metrics, alerts, queue attributes, and errors MUST NOT contain tokens, secrets, emails, raw learner content, provider payloads, card data, signed URLs, or unrestricted Problem `detail`.
- Structured logs include timestamp, severity, service, environment, operation/event, safe stable code, status, duration, correlation/trace/request/run IDs, and a pseudonymous actor where necessary.
- Do not log request/response bodies by default. Redaction is a secondary control, not permission to collect.
- Security-, release-, billing-, assessment-, and privacy-relevant privileged actions produce append-only audit events. Audit evidence is integrity-protected and access-controlled.
- New data collection requires purpose, lawful basis, classification, location, subprocessor/transfer, access, retention, deletion/export, telemetry, and incident behavior before merge.
- Learner content MUST NOT be used for model training or evaluation without separate specific optional consent and enforceable provider controls.

## 14. Accessibility and internationalization

- Core web and mobile journeys MUST meet WCAG 2.2 AA where applicable and pass the supported browser/OS/assistive-technology matrix.
- Use semantic platform controls first. All interactions require accessible names, keyboard/switch operation, logical focus, visible focus, text scaling, sufficient contrast, non-color cues, and screen-reader announcements for dynamic state.
- Audio has accessible controls and transcripts according to activity policy. Motion respects reduced-motion preferences. Touch targets and error recovery meet platform accessibility guidance.
- Accessibility tests combine static analysis, component tests, automated journey checks, and manual assistive-technology review. Automated tools alone are insufficient.
- User-facing strings are externalized; do not concatenate translated fragments. Support pluralization, grammatical variables, locale-aware date/number/currency formatting, and text expansion.
- Internal identifiers and API/database values are locale-independent. Initial English interface scope does not permit English hard-coding that blocks later locales. German learning content remains versioned content, not UI literals.

## 15. Testing standard

Tests must be deterministic, isolated, parallel-safe, and behavior-focused. Flaky tests are defects: quarantine requires an owner, issue, expiry, and non-release-blocking justification.

- **Unit:** domain rules, reducers, parsers, mappers, validators, state machines, scoring, authorization predicates, and failure classification. No real network/database.
- **Integration:** real PostgreSQL and Redis-compatible instances where behavior matters; migrations, constraints, RLS, transactions, repositories, inbox/outbox, workers, checkpoints, and provider adapters against controlled fakes/sandboxes.
- **Contract:** OpenAPI request/response/status/header/error behavior, generated clients, event schema/version compatibility, SSE order/resume, Stripe webhook signature/raw-body behavior, and provider adapter fixtures.
- **End to end:** critical web, iOS, and Android journeys from identity through learning, AI safe failure, progress, privacy, support, checkout, and entitlement. Use production-like configuration and accessible selectors.
- **Load/resilience:** launch and 2x forecast; API latency/error/saturation, queue age, connection pools, worker scaling, AI budgets/cost, duplicate/reordered delivery, dependency outage, Redis flush, and recovery.
- **AI evaluation:** immutable teacher-labeled A1-B2 datasets, adversarial cases, linguistic/CEFR/rubric/safety/latency/cost gates, denominators, confidence intervals, and release-to-release regression.
- **Security/privacy:** cross-user denial for every owned resource, scope/role matrices, injection, SSRF/egress, webhook abuse, upload validation, secret/dependency/static/dynamic scans, prohibited-data telemetry capture, retention/export/deletion.

Bug fixes require a regression test at the lowest effective layer. Changed behavior requires positive, negative, boundary, authorization, retry/idempotency, and failure-path coverage. Coverage percentages are signals, not substitutes for risk-based assertions; critical domain and security branches MUST be exercised.

## 16. Dependency rules

- Add a dependency only when the standard library or an existing approved dependency cannot meet the requirement safely and maintainably.
- Use `pnpm` to add the repository-approved current version; never hand-invent a version. Runtime dependencies are exact or lockfile-pinned according to repository policy.
- The pull request documents purpose, maintenance health, license, security posture, bundle/runtime/cold-start cost, data egress, and viable alternatives for material dependencies.
- Prefer platform APIs and small focused libraries. Duplicate libraries for schema, dates, HTTP, logging, testing, or state management require explicit approval.
- Production packages MUST NOT depend on dev-only tooling. Client packages MUST NOT depend on server-only packages. Native dependencies require iOS/Android compatibility and accessibility/privacy review.
- Automated update PRs run the full relevant suite. Major upgrades and security-sensitive provider SDK upgrades are isolated changes with migration notes.
- Lockfile integrity, license policy, vulnerability scanning, unused/dependency-boundary checks, and provenance/SBOM generation are CI gates. Critical/high release-blocking findings require remediation or an approved expiring risk acceptance.

## 17. CI quality gates

Every pull request MUST pass, as applicable:

1. repository cleanliness, pinned toolchain, frozen install, and generated-artifact drift;
2. formatting and linting with zero warnings;
3. strict type checking for all affected packages;
4. unit, integration, contract, end-to-end, and evaluation suites selected by impact, with changed-code coverage policy;
5. production builds for Next.js, NestJS services/workers, and React Native type/bundle checks;
6. OpenAPI lint/compatibility and generated-client drift checks;
7. migration naming/checksum checks, empty-database creation, previous-snapshot upgrade, RLS/constraint tests, and application compatibility;
8. module-boundary, cycle, unused dependency, duplicate dependency, and forbidden-import checks;
9. secret, SAST, dependency, license, container, IaC, and API security scans;
10. accessibility and i18n static/component/journey checks;
11. infrastructure validation/plan for affected environments;
12. AI frozen evaluation and rollout evidence for any prompt, model, graph, tool, schema, policy, or gateway change;
13. load/resilience evidence when a change affects capacity, latency, queues, database access, streaming, or cost.

Required checks cannot be skipped or marked optional to merge. Release branches additionally require the measurable gates and retained evidence in `docs/MVP_SCOPE.md`.

## 18. Commits and pull requests

- Commits are small, coherent, buildable, and use the repository's established imperative convention. Do not mix generated churn, dependency upgrades, schema changes, and unrelated refactors.
- Never commit secrets, local environment files, production data, raw learner content, provider payloads, or unapproved generated fixtures.
- Pull requests state the problem and outcome, requirement/ADR links, scope and non-goals, design/boundary impact, tests and evidence, security/privacy/accessibility/i18n impact, API/event/database compatibility, observability, rollout, and rollback.
- API, event, migration, dependency, AI release, billing, identity, privacy, and infrastructure changes require reviewers who own those risks. Authors cannot self-approve governed content or AI releases.
- Reviewers reject hidden breaking changes, cross-module writes, missing failure states, unbounded retries/queries, unsafe logs, unverifiable AI behavior, absent migration strategy, or tests that only assert the happy path.
- Merge only after required approvals and checks. Emergency changes follow the incident process and receive an immediate follow-up review; urgency does not waive audit, safety, or rollback requirements.

## 19. Documentation

- Code and documentation change together. Update OpenAPI, database/API/AI contracts, ADRs, runbooks, data inventory, threat models, SLOs, diagrams, and release notes when their behavior changes.
- `docs/architecture.md` is the technical authority; `docs/MVP_SCOPE.md` is the MVP release authority. Contradictions are resolved explicitly, not copied into code.
- Public APIs, packages, events, migrations, environment variables, operational commands, alerts, and runbooks have owner-oriented documentation.
- Comments and READMEs MUST remain testable and current. Examples use synthetic data and pinned commands.
- A decision that changes a fixed architecture choice requires a new ADR that supersedes the old one; do not edit history to imply the previous decision never existed.

## 20. Definition of Done

A change is done only when:

- acceptance criteria and applicable requirement IDs are satisfied without adding excluded/post-MVP scope;
- implementation follows strict TypeScript, runtime validation, module boundaries, and repository conventions;
- API/event/database/client contracts and generated artifacts agree;
- migrations are explicit, forward-safe, tested from empty and upgrade paths, and have rollout/recovery plans;
- authorization, privacy, retention, security, accessibility, i18n, entitlement, idempotency, and failure states are implemented and tested;
- unit, integration, contract, end-to-end, load/resilience, and AI evaluation evidence is complete in proportion to risk;
- logs, traces, metrics, dashboards, alerts, SLO impact, and runbooks make production behavior operable without exposing prohibited data;
- dependencies and infrastructure pass policy and security checks;
- documentation and ADRs are current;
- CI and relevant MVP release gates pass with no unresolved critical/high release-blocking finding;
- rollout, compatibility, feature flag/kill switch where needed, and tested rollback are defined;
- no temporary bypass, TODO, disabled test, or waiver remains without an owner, tracked issue, and expiry.
