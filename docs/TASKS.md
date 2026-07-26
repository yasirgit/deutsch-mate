# Deutsch Mate MVP Execution Backlog

**Status:** executable implementation backlog  
**Release authority:** `docs/MVP_SCOPE.md`  
**Technical authority:** `docs/architecture.md`  
**Contract authorities:** `docs/Database.md`, `docs/API.md`, `docs/openapi.yaml`, `docs/AI_AGENTS.md`  
**Implementation standard:** `docs/CODING_STANDARDS.md`

## How to execute and maintain this backlog

- Work only when every listed dependency is `DONE`. Task numbers are stable identifiers, not a substitute for the dependency graph; independent lanes are intentionally interleaved by epic.
- Task IDs are permanent. Do not renumber or reuse them. Split new work with a suffix such as `DM-042A`.
- Status is one of `TODO`, `IN PROGRESS`, `BLOCKED`, or `DONE`. An agent starting or finishing work must update the task status and append concise evidence to its `Evidence` line in the same change.
- `DONE` means every acceptance criterion passes and verification evidence is linked or recorded. A merged implementation without required operational, security, accessibility, content, or release evidence is not done.
- Commands below are canonical commands expected after `DM-001`; before then, equivalent bootstrap-specific evidence is acceptable.
- All paths are planned paths and may be refined by `DM-001` without changing architectural ownership. Any material architecture change requires a superseding ADR.
- MVP contains only the requirements listed as in scope in `docs/MVP_SCOPE.md` §10. Post-MVP work is recorded only in the non-actionable horizon at the end.

## Dependency and parallelization map

**Critical path**

The declared release-driving dependencies converge as follows:

- foundation/API: `DM-001 → DM-002 → DM-020 → DM-021 → DM-022 → DM-023`, while `DM-001 → DM-025`; `DM-022 + DM-023 + DM-025 → DM-026`;
- identity/content: `DM-026 → DM-035 → DM-036`, `DM-029 → DM-030 → DM-032`, and `DM-036 + DM-032 → DM-037`; protected content operations converge separately at `DM-026 + DM-030 + DM-035 → DM-031`;
- billing/access: `DM-021 + DM-026 → DM-051 → DM-052 → DM-053`;
- deterministic learning: `DM-023 + DM-026 + DM-032 + DM-035 → DM-038 → DM-039`, then `DM-037 + DM-038 + DM-039 + DM-053 → DM-040`;
- AI: `DM-021 + DM-026 + DM-035 → DM-041 → DM-042 → DM-043`; `DM-032 + DM-037 + DM-043 + DM-053 → DM-044` and `DM-038 + DM-043 + DM-053 → DM-045`, then `DM-044 + DM-045 → DM-047`;
- clients: the web lane includes `DM-055 → DM-057`, and the mobile lane includes `DM-058 → DM-059`; both learning clients also depend on `DM-040 + DM-044 + DM-045`;
- integrated verification: API conformance, privacy lifecycle, web, and mobile converge in full at `DM-027 + DM-050 + DM-057 + DM-059 → DM-062`;
- release: `DM-048 + DM-054 + DM-060 + DM-061 + DM-062 → DM-063`; `DM-031 + DM-033 + DM-034 + DM-046 + DM-047 + DM-063 → DM-064`; `DM-062 + DM-064 → DM-065 → DM-066 → DM-067 → DM-068`, with every additional dependency declared on those tasks also required.

This path establishes the repository, database, contract-compliant API, identity, learning loop, integrated clients, production verification, beta, and launch. A slipped critical-path task must be surfaced immediately.

**Parallel lanes after `DM-002`**

- **Platform:** Epics 1–2 (IaC, CI, supply-chain security).
- **Data/API:** Epics 3–4, then identity, learning, privacy, and billing modules.
- **Content:** `DM-029`–`DM-034`; begin early because expert production and review are schedule risks.
- **AI:** `DM-041`–`DM-048`; golden-set labeling can run beside gateway/graph implementation.
- **Clients:** web and mobile shells can proceed from generated clients and fixtures while API modules are built.
- **Operations:** telemetry, runbooks, privacy inventory, threat models, and beta preparation proceed beside feature work.

Tasks in different lanes may run concurrently only when all listed dependencies are `DONE`. Contract, migration, generated-client, content-release, and AI-release changes require a single coordinating owner to prevent drift.

## Epic 0 — Governance and repository bootstrap

### DM-001 — Bootstrap the pinned monorepo
- **Status:** TODO
- **Outcome:** A reproducible strict-TypeScript `pnpm`/Turborepo workspace exists for all MVP runtimes.
- **Links:** NFR-015; ADR-002, ADR-003, ADR-006.
- **Depends on:** none.
- **Deliverables:** `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `.nvmrc`, `tsconfig.base.json`, `.editorconfig`, `.gitignore`, `apps/{web,mobile,api,ai-worker,billing-worker,privacy-worker,outbox-worker,media-worker}/`, `packages/{contracts,domain,config,observability,test-kit}/`, `infra/`, `migrations/`, `scripts/`.
- **Acceptance:** active LTS/runtime and package manager are pinned; strict compiler flags match coding standards; every workspace declares dependencies and canonical scripts; no speculative service, assessment, speech, or native-purchase package exists.
- **Verify:** `corepack enable && pnpm install --frozen-lockfile && pnpm format:check && pnpm lint && pnpm typecheck && pnpm build`.
- **Evidence:** _pending_

### DM-002 — Establish canonical local development
- **Status:** TODO
- **Outcome:** Contributors can start the API dependencies and all app shells from a clean checkout.
- **Links:** NFR-003, NFR-004, NFR-015; ADR-003, ADR-006, ADR-009, ADR-010.
- **Depends on:** DM-001.
- **Deliverables:** `compose.yaml`, `.env.example` with non-secret placeholders, `scripts/bootstrap-local.ts`, `scripts/wait-for-services.ts`, root `bootstrap`, `dev`, `dev:services`, `db:*`, and `test:*` scripts; developer setup in `README.md`.
- **Acceptance:** local PostgreSQL 16 and Redis are isolated and disposable; secrets are never committed; setup is idempotent; app shells expose liveness; Redis deletion does not affect seeded durable facts.
- **Verify:** `pnpm bootstrap && pnpm dev:services && pnpm db:reset && pnpm test:smoke`.
- **Evidence:** _pending_

### DM-003 — Enforce module and dependency boundaries
- **Status:** TODO
- **Outcome:** CI rejects forbidden imports, cycles, undeclared dependencies, and cross-capability persistence access.
- **Links:** NFR-005, NFR-015; ADR-002, ADR-003, ADR-006.
- **Depends on:** DM-001.
- **Deliverables:** `packages/config/` lint/TypeScript rules, dependency graph policy, forbidden-import tests, package ownership metadata.
- **Acceptance:** domain code cannot import framework/provider adapters; clients cannot import server/database code; workers cannot reach arbitrary capability repositories; no generic `common`/`utils` package is introduced.
- **Verify:** `pnpm lint && pnpm boundaries:check && pnpm deps:check`.
- **Evidence:** _pending_

### DM-004 — Create release evidence and ownership templates
- **Status:** TODO
- **Outcome:** Every governed change and release has consistent ownership, review, rollout, rollback, and evidence records.
- **Links:** FR-072; NFR-005, NFR-008, NFR-014, NFR-015; MVP G8; ADR-015, ADR-017, ADR-018.
- **Depends on:** DM-001.
- **Deliverables:** `.github/PULL_REQUEST_TEMPLATE.md`, `.github/CODEOWNERS`, `docs/runbooks/templates/`, `docs/release/evidence-template.md`, `docs/waivers/README.md`.
- **Acceptance:** templates require requirement/ADR mapping, data/security/accessibility impact, contract/migration compatibility, tests, observability, rollout and rollback; governed areas have named reviewer roles; waivers require owner and expiry.
- **Verify:** repository review of templates against `docs/CODING_STANDARDS.md` §§17–20.
- **Evidence:** _pending_

## Epic 1 — Infrastructure, environments, and delivery

### DM-005 — Select and baseline one IaC toolchain
- **Status:** TODO
- **Outcome:** A pinned, repository-approved AWS CDK or Terraform toolchain is selected and recorded.
- **Links:** NFR-016; ADR-007, ADR-019.
- **Depends on:** DM-001.
- **Deliverables:** implementation ADR `docs/adr/ADR-020-iac-toolchain.md`, pinned IaC manifests under `infra/`, environment configuration schemas.
- **Acceptance:** exactly one tool manages each resource; dev/staging/prod account boundaries and EU primary region are explicit; plans are deterministic and reviewable.
- **Verify:** `pnpm infra:fmt:check && pnpm infra:validate && pnpm infra:plan:dev`.
- **Evidence:** _pending_

### DM-006 — Provision isolated network and security foundations
- **Status:** TODO
- **Outcome:** Development, staging, and production have isolated three-AZ networking, keys, secrets, and deploy identities.
- **Links:** NFR-005, NFR-016; MVP G5, G8; ADR-007, ADR-017, ADR-019.
- **Depends on:** DM-005.
- **Deliverables:** `infra/modules/network/`, `infra/modules/kms/`, `infra/modules/iam/`, `infra/modules/secrets/`, environment stacks and least-privilege policies.
- **Acceptance:** only managed ingress is public; compute/data are private; no mutable state, credential, or key is shared across environments; CloudTrail and drift detection are enabled.
- **Verify:** `pnpm infra:plan:all && pnpm security:iam && pnpm infra:policy`.
- **Evidence:** _pending_

### DM-007 — Provision durable data and event infrastructure
- **Status:** TODO
- **Outcome:** RDS PostgreSQL, Redis, S3, EventBridge, SQS/DLQs, backups, and lifecycle controls satisfy the contracts.
- **Links:** NFR-003, NFR-012, NFR-016; MVP G4, G8; ADR-009–012, ADR-019.
- **Depends on:** DM-006.
- **Deliverables:** `infra/modules/{rds,redis,s3,eventing,backup}/`, cross-account backup vault/policies, queue alarms.
- **Acceptance:** RDS is Multi-AZ with PITR; Redis is disposable and isolated; S3 is private/versioned/SSE-KMS with required Object Lock/lifecycle; queues have bounded retries, DLQs, and replay permissions; target RPO is ≤5 minutes.
- **Verify:** `pnpm infra:plan:all && pnpm infra:test && pnpm security:iac`.
- **Evidence:** _pending_

### DM-008 — Provision edge, compute, and autoscaling
- **Status:** TODO
- **Outcome:** CloudFront/WAF, managed ingress, and private ECS Fargate services deploy API and workers independently.
- **Links:** NFR-001, NFR-002, NFR-005, NFR-013, NFR-016; ADR-007, ADR-018, ADR-019.
- **Depends on:** DM-006, DM-007.
- **Deliverables:** `infra/modules/{edge,ecs,autoscaling}/`, API and worker task definitions, health checks, deployment alarms.
- **Acceptance:** workloads use task roles and Secrets Manager; no secret enters images or client variables; scaling signals match architecture; rolling deployment has health rollback; EKS is absent.
- **Verify:** `pnpm infra:plan:staging && pnpm infra:test && pnpm test:deploy:staging`.
- **Evidence:** _pending_

### DM-009 — Implement CI/CD and environment promotion
- **Status:** TODO
- **Outcome:** Pull requests and reviewed promotions run all mandatory checks and produce auditable artifacts.
- **Links:** NFR-005, NFR-015, NFR-016; MVP G8; ADR-003, ADR-019.
- **Depends on:** DM-003, DM-005.
- **Deliverables:** `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, artifact/SBOM/signing configuration, protected environment rules.
- **Acceptance:** frozen install, formatting, lint, types, tests, builds, OpenAPI, migrations, dependencies, security, accessibility, IaC, and applicable AI/load checks are gates; production deploy requires reviewed promotion; deploys use short-lived identity and support rollback.
- **Verify:** `pnpm ci && pnpm release:verify`; successful protected-branch dry run.
- **Evidence:** _pending_

## Epic 2 — Security and supply-chain baseline

### DM-010 — Configure mandatory security scanning
- **Status:** TODO
- **Outcome:** Secrets, source, dependencies, licenses, containers, IaC, and the API are continuously scanned.
- **Links:** NFR-005, NFR-015; MVP G5, G8; ADR-017.
- **Depends on:** DM-009.
- **Deliverables:** scan configurations, allowlist policy, SBOM/provenance output, vulnerability triage template.
- **Acceptance:** critical/high release-blocking findings fail CI; exceptions require owner and expiry; scans use synthetic data; generated artifacts and containers are included.
- **Verify:** `pnpm security:secrets && pnpm security:sast && pnpm security:deps && pnpm security:licenses && pnpm security:containers && pnpm security:iac && pnpm security:api`.
- **Evidence:** _pending_

### DM-011 — Complete MVP threat models
- **Status:** TODO
- **Outcome:** Identity, cross-user access, AI injection/egress, learner content, uploads, Stripe webhooks, and operations have approved threat models.
- **Links:** NFR-005–007; MVP G5; ADR-013–017.
- **Depends on:** DM-004; may run in parallel with implementation and must finish before DM-060.
- **Deliverables:** `docs/security/threat-model-{identity,authorization,ai,content,uploads,billing,operations}.md`, mitigation tracker.
- **Acceptance:** trust boundaries, abuse cases, controls, residual risks, owners, and verification are recorded; no unresolved critical/high release blocker remains.
- **Verify:** approved review evidence plus `pnpm security:all`.
- **Evidence:** _pending_

### DM-012 — Implement shared secure configuration and redaction
- **Status:** TODO
- **Outcome:** Every process validates configuration and emits safe structured telemetry.
- **Links:** NFR-005, NFR-011, NFR-015; ADR-002, ADR-017, ADR-018.
- **Depends on:** DM-001.
- **Deliverables:** `packages/config/`, `packages/observability/`, strict environment schemas, redaction/prohibited-data tests.
- **Acceptance:** unknown/missing config fails startup; secrets are sourced through workload identity; logs exclude credentials, emails, raw chat/writing, provider payloads, card data, and signed URLs.
- **Verify:** `pnpm test --filter @deutsch-mate/config --filter @deutsch-mate/observability && pnpm test:telemetry-safety`.
- **Evidence:** _pending_

## Epic 3 — PostgreSQL, migrations, authorization, and messaging

### DM-020 — Build migration runner and database roles
- **Status:** TODO
- **Outcome:** Forward-only SQL migrations run with checksums and least-privilege runtime roles.
- **Links:** NFR-003, NFR-005, NFR-012, NFR-015; ADR-009, ADR-012.
- **Depends on:** DM-002.
- **Deliverables:** `packages/database/`, `scripts/migrate.ts`, `migrations/0001_extensions_roles.sql`, migration ledger and test harness.
- **Acceptance:** Kysely/node-postgres are adapters; runtime DDL/auto-sync is impossible; migrator and API/worker roles match `docs/Database.md`; lock and statement timeouts are enforced.
- **Verify:** `pnpm db:create-empty && pnpm db:migrate && pnpm db:migrations:verify`.
- **Evidence:** _pending_

### DM-021 — Implement the MVP relational schema
- **Status:** TODO
- **Outcome:** All and only MVP tables, constraints, indexes, enums, immutable triggers, and capability ownership exist.
- **Links:** FR-001–003, FR-010, FR-020–024, FR-030–032, FR-040–041, FR-050, FR-052, FR-060–063, FR-070–072; NFR-003, NFR-014; ADR-009, ADR-011, ADR-016, ADR-017.
- **Depends on:** DM-020.
- **Deliverables:** ordered explicit SQL under `migrations/` for `iam`, `learner`, `media`, `content`, `learning`, `ai`, `billing`, `privacy`, `support`, and `ops`; Kysely persistence types under `packages/database/src/generated/`.
- **Acceptance:** schema matches `docs/Database.md`; UUIDv7/UTC/money/numeric rules hold; append-only facts and published versions cannot mutate; no assessment, speaking, reminders, conversation-history UI, or native-IAP tables exist.
- **Verify:** `pnpm db:reset && pnpm db:contract && pnpm db:constraints && pnpm db:immutability`.
- **Evidence:** _pending_

### DM-022 — Enforce RLS and capability grants
- **Status:** TODO
- **Outcome:** Every user-owned resource is deny-by-default and inaccessible cross-user at the database boundary.
- **Links:** FR-001, FR-041, FR-070; NFR-005, NFR-006; MVP G5; ADR-009, ADR-013, ADR-017.
- **Depends on:** DM-021.
- **Deliverables:** RLS/grant migrations, transaction context adapter, ownership and staff-role policy tests.
- **Acceptance:** RLS is enabled and forced; runtime roles cannot bypass it; child ownership is enforced through parents; admin is not a bypass; security-definer functions satisfy the database contract.
- **Verify:** `pnpm db:rls && pnpm test:authorization`; evidence covers positive and negative cases for 100% of user-owned resource types.
- **Evidence:** _pending_

### DM-023 — Implement idempotency, outbox, inbox, and audit primitives
- **Status:** TODO
- **Outcome:** Retried commands and at-least-once messages yield one effective, auditable business outcome.
- **Links:** NFR-011, NFR-012; ADR-012, ADR-018.
- **Depends on:** DM-021, DM-022.
- **Deliverables:** `packages/domain/src/idempotency/`, API interceptor, `apps/outbox-worker/`, inbox consumer library, event runtime schemas, audit hash/export job.
- **Acceptance:** canonical request hash replay/conflict semantics match API contract; business mutation and outbox insert share a transaction; consumers atomically claim inbox/effects; bounded retries, DLQ, replay, correlation/causation IDs work.
- **Verify:** `pnpm test:integration --filter idempotency --filter messaging --filter audit && pnpm test:resilience:duplicates`.
- **Evidence:** _pending_

### DM-024 — Prove safe migration and restore paths
- **Status:** TODO
- **Outcome:** Empty builds, previous-snapshot upgrades, expand/contract compatibility, and recovery are automated.
- **Links:** NFR-003, NFR-015; MVP G4, G8; ADR-009, ADR-019.
- **Depends on:** DM-021.
- **Deliverables:** `scripts/db-verify-upgrade.ts`, production-shaped sanitized fixture, restore/checksum scripts, `docs/runbooks/database-restore.md`.
- **Acceptance:** CI builds empty DB and upgrades prior shape; destructive rollout is absent; restore applies deletion suppression before traffic; achieved RPO ≤5 minutes and RTO evidence is retained.
- **Verify:** `pnpm db:test:empty && pnpm db:test:upgrade && pnpm test:restore`.
- **Evidence:** _pending_

## Epic 4 — API foundation and generated clients

### DM-025 — Establish contract-first generation
- **Status:** TODO
- **Outcome:** `docs/openapi.yaml` is linted and generates the sole web/mobile API client contract.
- **Links:** NFR-010, NFR-015; ADR-008.
- **Depends on:** DM-001.
- **Deliverables:** pinned generator/linter configuration, `packages/api-client/`, `packages/api-schemas/`, generation and compatibility scripts.
- **Acceptance:** generated code is never hand-edited; clean-tree drift fails CI; operation IDs, RFC 9457 types, UUIDv7, decimals/bigints, and SSE helpers preserve the specification.
- **Verify:** `pnpm openapi:lint && pnpm openapi:generate && pnpm openapi:drift && pnpm openapi:compat`.
- **Evidence:** _pending_

### DM-026 — Implement Product API cross-cutting behavior
- **Status:** TODO
- **Outcome:** The NestJS `/v1` API consistently validates, authenticates, authorizes, correlates, errors, paginates, and handles concurrency.
- **Links:** NFR-005, NFR-010–012, NFR-015; ADR-006, ADR-008, ADR-013, ADR-018.
- **Depends on:** DM-022, DM-023, DM-025.
- **Deliverables:** `apps/api/src/platform/` guards/interceptors/filters, health routes, strict request validation, ETag/cursor/idempotency/correlation implementations.
- **Acceptance:** unknown fields fail; every response has request ID; Problem Details leaks no internals; stale ETags and idempotency conflicts match contract; actor is never selected from request data; health behavior is deploy-safe.
- **Verify:** `pnpm test:contract --filter api-platform && pnpm test:integration --filter api-platform`.
- **Evidence:** _pending_

### DM-027 — Verify complete OpenAPI conformance
- **Status:** TODO
- **Outcome:** Every documented operation, status, header, content type, ownership rule, and failure state has an executable contract test.
- **Links:** NFR-010, NFR-012, NFR-015; MVP G7; ADR-008.
- **Depends on:** all API module tasks DM-031, DM-035, DM-038, DM-040, DM-047, DM-054, DM-056.
- **Deliverables:** `apps/api/test/contract/`, generated-client compatibility fixtures for web/mobile.
- **Acceptance:** no undocumented route/response is exposed; SSE sequencing uses `docs/API.md`; clients pass against the same server build; cross-user absence is returned as required.
- **Verify:** `pnpm openapi:lint && pnpm test:contract && pnpm openapi:drift`.
- **Evidence:** _pending_

## Epic 5 — Identity, consent, and onboarding

### DM-035 — Implement Cognito/OIDC and product user lifecycle
- **Status:** TODO
- **Outcome:** Adult users can register, verify, sign in/out, recover, resolve a product user, and initiate deletion without local passwords.
- **Links:** FR-001; NFR-005, NFR-006; ADR-013, ADR-017.
- **Depends on:** DM-026; infrastructure integration also depends on DM-006.
- **Deliverables:** `apps/api/src/modules/identity/`, Cognito IaC/config, OIDC token verifier, user provisioning and account-state guards, current-user read/update routes including `PATCH /me` for interface locale.
- **Acceptance:** Authorization Code + PKCE; issuer/audience/signature/expiry/scopes validated; short-lived tokens only; blocked/deletion-pending users lose product access; age gate is adult-directed; `PATCH /me` updates the allowed locale field with optimistic concurrency and idempotent replay; no password/token persistence.
- **Verify:** `pnpm test:contract --filter identity-profile && pnpm test:integration --filter identity && pnpm test:security --filter oidc --filter account-isolation`.
- **Evidence:** _pending_

### DM-036 — Implement versioned consent and legal documents
- **Status:** TODO
- **Outcome:** Required legal acceptance and optional marketing consent are independently append-only and client-portable.
- **Links:** FR-002, FR-070; NFR-006; MVP G5; ADR-017.
- **Depends on:** DM-035.
- **Deliverables:** identity consent services/routes, legal-document seed/import tooling, consent UI contract fixtures.
- **Acceptance:** terms/privacy versions and decisions are durable; optional consent is unbundled, skippable, and withdrawable; withdrawal does not remove core paid access; all clients record source and version.
- **Verify:** `pnpm test:contract --filter consent && pnpm test:integration --filter consent && pnpm test:e2e --filter consent`.
- **Evidence:** _pending_

### DM-037 — Implement profiles and resumable onboarding
- **Status:** TODO
- **Outcome:** A user selects A1–B2, goal, cadence, locale/preferences, resumes onboarding cross-device, and reaches a first unit.
- **Links:** FR-003, FR-010, FR-052; MVP G2; ADR-001.
- **Depends on:** DM-036, DM-032.
- **Deliverables:** `apps/api/src/modules/learner/`, profile/onboarding routes, versioned profile/proficiency services, client fixtures that preserve the identity-owned interface locale updated through `PATCH /me`.
- **Acceptance:** optional questions can be skipped; updates append versions; state survives interruption; account locale and learner preferences remain correctly separated across profile reads/updates; self-selection is explicit and no LLM placement occurs; recommendation is bounded to published content.
- **Verify:** `pnpm test:contract --filter onboarding && pnpm test:integration --filter learner && pnpm test:e2e --filter first-session`.
- **Evidence:** _pending_

## Epic 6 — Content pipeline and launch inventory

### DM-029 — Define versioned content schemas and authoring format
- **Status:** TODO
- **Outcome:** Curriculum, rich text, activities, answers, rubrics, assets, objectives, and CEFR mappings have strict authoring schemas.
- **Links:** FR-020–024, FR-050, FR-052, FR-072; NFR-014; ADR-001, ADR-015.
- **Depends on:** DM-001.
- **Deliverables:** `packages/content-schemas/`, `content/schema/`, authoring examples, deterministic validators.
- **Acceptance:** unknown fields fail; no HTML/executable answer expressions; stable keys and immutable versions are represented; schemas cover all MVP activity types and exclude speaking/assessment constructs.
- **Verify:** `pnpm content:schema && pnpm test --filter @deutsch-mate/content-schemas`.
- **Evidence:** _pending_

### DM-030 — Build content import, validation, and manifest tooling
- **Status:** TODO
- **Outcome:** Approved source files deterministically produce database imports and immutable release manifests.
- **Links:** FR-020–023, FR-050, FR-072; NFR-014; MVP G1; ADR-011, ADR-015.
- **Depends on:** DM-021, DM-029.
- **Deliverables:** `content/`, `scripts/content-{validate,import,manifest}.ts`, asset checksum/availability validators.
- **Acceptance:** validates six units/level module, prerequisites, CEFR links, ≥12 deterministic interactions/unit, listening/transcript policy, writing, formative check, objective weights, answer/rubric coverage, assets, and prohibited certification copy.
- **Verify:** `pnpm content:validate && pnpm content:manifest && pnpm content:test-import`.
- **Evidence:** _pending_

### DM-031 — Implement protected content governance
- **Status:** TODO
- **Outcome:** Staff can create, submit, independently approve/reject, publish, and roll back immutable curriculum releases.
- **Links:** FR-020, FR-072; NFR-005, NFR-014; MVP G1, G8; ADR-009, ADR-015, ADR-017.
- **Depends on:** DM-026, DM-030, DM-035.
- **Deliverables:** `apps/api/src/modules/content/`, protected operations from OpenAPI, publication transaction and audit events, minimal staff scripts/UI.
- **Acceptance:** editor cannot self-approve; drafts never reach learner routes; publication revalidates exact manifest in bounded serializable transaction; rollback selects a prior approved version without rewriting history.
- **Verify:** `pnpm test:contract --filter content-ops && pnpm test:integration --filter content-publication && pnpm test:authorization --filter content`.
- **Evidence:** _pending_

### DM-032 — Implement published curriculum delivery
- **Status:** TODO
- **Outcome:** Entitlement-filtered immutable releases, modules, units, lessons, activities, and accessible listening metadata are served by the API.
- **Links:** FR-020–023, FR-050, FR-052, FR-063; NFR-004, NFR-010.
- **Depends on:** DM-026, DM-030.
- **Deliverables:** content read repositories/services/routes, immutable ETags, published-only database views and cache.
- **Acceptance:** exact version IDs resolve; free/premium visibility is server-enforced; listening controls receive transcript policy and approved assets; AI outage has no effect; draft/cross-release content is hidden.
- **Verify:** `pnpm test:contract --filter curriculum && pnpm test:integration --filter curriculum && pnpm test:resilience --filter ai-outage`.
- **Evidence:** _pending_

### DM-033 — Produce the A1 and A2 launch modules
- **Status:** TODO
- **Outcome:** A1 and A2 each contain one coherent, qualified-expert-approved six-unit module.
- **Links:** FR-020–024, FR-050, FR-052; MVP G1; ADR-001, ADR-015.
- **Depends on:** DM-029; can run parallel with DM-030–DM-032.
- **Deliverables:** versioned source and licensed audio/assets under `content/releases/mvp/{a1,a2}/`, review records.
- **Acceptance:** every unit meets the complete launch inventory; module-wide skills coverage is met; German correctness, CEFR mapping, accessibility metadata, and non-certification copy are approved by a qualified reviewer.
- **Verify:** `pnpm content:validate --levels A1,A2`; signed expert-review evidence.
- **Evidence:** _pending_

### DM-034 — Produce the B1 and B2 launch modules
- **Status:** TODO
- **Outcome:** B1 and B2 each contain one coherent, qualified-expert-approved six-unit module.
- **Links:** FR-020–024, FR-050, FR-052; MVP G1; ADR-001, ADR-015.
- **Depends on:** DM-029; can run parallel with DM-033.
- **Deliverables:** versioned source and licensed audio/assets under `content/releases/mvp/{b1,b2}/`, review records.
- **Acceptance:** same inventory, quality, mapping, accessibility, and governance criteria as DM-033.
- **Verify:** `pnpm content:validate --levels B1,B2`; signed expert-review evidence.
- **Evidence:** _pending_

## Epic 7 — Learning loop, review, recommendation, and progress

### DM-038 — Implement learning sessions and deterministic scoring
- **Status:** TODO
- **Outcome:** Learners can start/resume sessions and submit all deterministic MVP activity types exactly once.
- **Links:** FR-021–023, FR-050; NFR-004, NFR-012, NFR-014.
- **Depends on:** DM-023, DM-026, DM-032, DM-035.
- **Deliverables:** `apps/api/src/modules/learning/`, session/attempt/scoring services and routes, answer-key algorithms.
- **Acceptance:** attempts pin content/key/algorithm versions; each scored submission atomically writes response, score/evidence, projections, and outbox; duplicate keys return one result; progress saves after every scored activity.
- **Verify:** `pnpm test:contract --filter learning && pnpm test:integration --filter deterministic-scoring && pnpm test:resilience:duplicates`.
- **Evidence:** _pending_

### DM-039 — Implement review scheduling
- **Status:** TODO
- **Outcome:** Valid evidence creates a bounded, deterministic, versioned due-review queue.
- **Links:** FR-023, FR-030; NFR-004, NFR-012.
- **Depends on:** DM-038.
- **Deliverables:** review algorithm package, projection updater/rebuilder, review API query.
- **Acceptance:** vocabulary/grammar/eligible mistakes schedule reproducibly; invalid/unverified AI creates no valid review evidence; queue ordering and bounds are stable; projection can rebuild from append-only evidence.
- **Verify:** `pnpm test --filter review-algorithm && pnpm test:integration --filter review && pnpm test:rebuild-projections`.
- **Evidence:** _pending_

### DM-040 — Implement next-activity recommendation and progress
- **Status:** TODO
- **Outcome:** Every learner receives one reproducible next lesson/review/upgrade and a truthful progress dashboard.
- **Links:** FR-031, FR-032, FR-052, FR-063; MVP G2, G9.
- **Depends on:** DM-037, DM-038, DM-039, DM-053.
- **Deliverables:** recommendation algorithm/version registry, immutable recommendation snapshots, progress/proficiency projections and routes.
- **Acceptance:** prerequisites, recent evidence, due review, goal, and entitlement are considered; locked content yields an unlocked alternative or plan action; completion and proficiency are separate; estimate includes date/uncertainty/disclaimer and never uses time/chat volume alone.
- **Verify:** `pnpm test --filter recommendation --filter progress && pnpm test:contract --filter learning-progress && pnpm test:e2e --filter daily-loop`.
- **Evidence:** _pending_

## Epic 8 — AI gateway, LangGraph workflows, and evaluations

### DM-041 — Implement immutable AI registries and release governance
- **Status:** TODO
- **Outcome:** Prompts, models, schemas, policies, and feature releases are immutable, reviewed, publishable, kill-switchable, and rollbackable.
- **Links:** FR-041, FR-072; NFR-007, NFR-008, NFR-014; ADR-014, ADR-015.
- **Depends on:** DM-021, DM-026, DM-035.
- **Deliverables:** AI registry repositories/services, protected OpenAPI operations, release manifest/evaluation checks, feature kill switches.
- **Acceptance:** only `tutor_chat`, `writing_correction`, and `content_validation` exist; releases pin all versions and rollback target; creator cannot self-approve; no arbitrary model/prompt/tool input is accepted.
- **Verify:** `pnpm test:contract --filter ai-releases && pnpm test:integration --filter ai-governance && pnpm test:authorization --filter ai-release`.
- **Evidence:** _pending_

### DM-042 — Implement the internal OpenAI gateway
- **Status:** TODO
- **Outcome:** Every model call passes through one strict, budgeted, privacy-minimized, observable provider boundary.
- **Links:** FR-040, FR-041; NFR-002, NFR-005–008, NFR-011; ADR-014, ADR-015, ADR-017, ADR-018.
- **Depends on:** DM-012, DM-023, DM-041, DM-053.
- **Deliverables:** `apps/ai-worker/src/gateway/`, typed provider port/adapter, structured-output validator, budget/usage adapter, retry/circuit/fallback policy.
- **Acceptance:** credentials stay in Secrets Manager; hosts/models/parameters are allowlisted; strict JSON schema plus semantic validation fails closed; bounded timeout/retry/circuit/fallback; PII minimization and no-training controls; tokens/cost use exact integer accounting; no learner-content semantic cache.
- **Verify:** `pnpm test:integration --filter ai-gateway && pnpm test:security --filter ai-egress && pnpm test:resilience --filter provider-outage`.
- **Evidence:** _pending_

### DM-043 — Implement LangGraph durability and bounded tools
- **Status:** TODO
- **Outcome:** Closed-registry graphs checkpoint safely in PostgreSQL and replay side effects exactly once.
- **Links:** FR-041; NFR-004, NFR-005, NFR-007, NFR-012; ADR-010, ADR-012, ADR-014.
- **Depends on:** DM-023, DM-041, DM-042.
- **Deliverables:** `apps/ai-worker/src/graphs/registry.ts`, checkpointer adapter, strict state schemas, typed tool registry, context builder, effect ledger and worker consumer.
- **Acceptance:** bounded steps/loops; no dynamic tools/web/shell/code/SQL; tools independently authorize; context is released/owned/minimized/versioned; checkpoints exclude secrets/signed URLs; replay/crash cannot duplicate terminal effects; Redis is optional cache only.
- **Verify:** `pnpm test --filter graph-topology --filter graph-state && pnpm test:integration --filter graph-replay --filter graph-permissions && pnpm test:resilience:redis`.
- **Evidence:** _pending_

### DM-044 — Implement `text_tutor.v1` and safe SSE recovery
- **Status:** TODO
- **Outcome:** Entitled learners receive verified, curriculum-grounded tutor responses with durable recovery and safe failure.
- **Links:** FR-040, FR-041; NFR-002, NFR-004, NFR-007; MVP G2–G4; ADR-008, ADR-014, ADR-015.
- **Depends on:** DM-032, DM-037, DM-043, DM-053.
- **Deliverables:** text tutor graph/nodes, tutor API admission/status/SSE routes, stream fragment cache and client helper.
- **Acceptance:** admission durably debits allowance; only necessary context is supplied; output is buffered until verified; event order/resume/410/durable polling match contracts; timeout/block/failure creates no mastery; duplicate message/key produces one run; AI outage preserves deterministic learning.
- **Verify:** `pnpm test:contract --filter tutor && pnpm test:integration --filter text-tutor --filter sse-resume && pnpm test:resilience --filter ai-outage`.
- **Evidence:** _pending_

### DM-045 — Implement `writing_correction.v1`
- **Status:** TODO
- **Outcome:** Short writing receives verified structured correction and retry guidance, or explicit unavailable feedback without false evidence.
- **Links:** FR-024, FR-050; NFR-004, NFR-007, NFR-012; MVP G1–G4; ADR-014, ADR-015.
- **Depends on:** DM-038, DM-043, DM-053.
- **Deliverables:** writing graph/nodes, LearningModule terminal transaction, feedback job route, 90-day content expiry.
- **Acceptance:** rubric dimensions, corrected text, prioritized explanations, and retry are complete; quoted excerpts and meaning preservation validate; one repair maximum; eligible verified evidence only; every failure writes unavailable feedback and invalid/unverified evidence.
- **Verify:** `pnpm test:contract --filter writing-feedback && pnpm test:integration --filter writing-correction && pnpm test:resilience --filter writing-crash`.
- **Evidence:** _pending_

### DM-046 — Implement `content_validation.v1`
- **Status:** TODO
- **Outcome:** Deterministic and independent-model findings support human content/AI release review without authority to approve.
- **Links:** FR-020–024, FR-041, FR-050, FR-052, FR-072; NFR-008, NFR-014; ADR-015.
- **Depends on:** DM-030, DM-041, DM-043.
- **Deliverables:** content-validation graph, manifest validators, finding schemas, append-only validation evidence.
- **Acceptance:** hard deterministic failures skip critic; findings reference stable codes/versions/hashes; graph cannot approve/publish under any role or input; publication independently reruns validators.
- **Verify:** `pnpm test:integration --filter content-validation && pnpm test:authorization --filter content-validation`.
- **Evidence:** _pending_

### DM-047 — Build frozen AI evaluation and release gating
- **Status:** TODO
- **Outcome:** AI changes cannot ship without reproducible A1–B2 quality, safety, latency, cost, and privacy evidence.
- **Links:** FR-024, FR-040, FR-041, FR-072; NFR-007, NFR-008; MVP G3; ADR-015.
- **Depends on:** DM-044, DM-045; dataset production may start after DM-029.
- **Deliverables:** `evals/` harness, immutable dataset manifests, ≥100 qualified-teacher-labeled cases per level, adversarial/safe subsets, metric reports and CI gate.
- **Acceptance:** ≥95% linguistic acceptability; ≥90% CEFR fit; ≤3% material correction error; 0% unsafe release; ≤5% over-refusal; ≥99% structured/verifier pass; denominators/confidence intervals retained; failed cases safe; release and rollback pins recorded.
- **Verify:** `pnpm eval:validate && pnpm eval:offline --release <id> && pnpm eval:gates --release <id>`.
- **Evidence:** _pending_

### DM-048 — Implement controlled AI rollout and rollback
- **Status:** TODO
- **Outcome:** AI releases deploy dark, shadow only when lawful, canary through controlled cohorts, halt automatically, and roll back independently.
- **Links:** FR-072; NFR-007, NFR-008, NFR-011; MVP G3, G8; ADR-014, ADR-015, ADR-018.
- **Depends on:** DM-041, DM-047, DM-060.
- **Deliverables:** routing/canary configuration, rollout evaluator, automatic halt rules, `docs/runbooks/ai-{outage,unsafe-output,rollback,cost-spike}.md`.
- **Acceptance:** stages and observation evidence follow AI agent contract; unsafe/cross-user/gate/SLO/budget breach halts; in-flight pins remain immutable unless safety/privacy requires cancellation; rollback restores an approved release.
- **Verify:** `pnpm test:ai-rollout && pnpm runbook:test -- ai-rollback`.
- **Evidence:** _pending_

## Epic 9 — Stripe billing and internal entitlements

### DM-051 — Implement plan, price, and feature configuration
- **Status:** TODO
- **Outcome:** Free/Premium packaging, monthly/annual EUR prices, and allowances are versioned server configuration.
- **Links:** FR-060, FR-063; ADR-001, ADR-016.
- **Depends on:** DM-021, DM-026.
- **Deliverables:** `apps/api/src/modules/billing/` plan reads, seed/config import, Free/Premium feature mapping.
- **Acceptance:** launch has one paid tier and no trial; terms/tax behavior/renewal/cancellation/limits are returned from effective config; clients contain no authoritative prices or limits.
- **Verify:** `pnpm test:contract --filter billing-plans && pnpm test:integration --filter plan-config`.
- **Evidence:** _pending_

### DM-052 — Implement Stripe Checkout and signed webhook processing
- **Status:** TODO
- **Outcome:** Web checkout uses Stripe-hosted subscription mode and signed events update provider state exactly once.
- **Links:** FR-061; NFR-005, NFR-012; MVP G6; ADR-016.
- **Depends on:** DM-023, DM-051.
- **Deliverables:** checkout adapter/route, raw-body webhook route, webhook worker, restricted-key/secret configuration; pinned Stripe API `2026-05-27.dahlia`.
- **Acceptance:** exact raw body is verified before parsing; no `payment_method_types` is set; event IDs persist once; delayed/duplicate/reordered events are safe; browser redirect never grants access; no card data/provider secrets are stored or logged.
- **Verify:** `pnpm test:contract --filter stripe && pnpm test:integration --filter stripe-webhooks && pnpm test:security --filter webhook`.
- **Evidence:** _pending_

### DM-053 — Implement internal entitlements and durable allowances
- **Status:** TODO
- **Outcome:** Product access and AI usage are decided from PostgreSQL, independently of synchronous Stripe availability.
- **Links:** FR-061–063; NFR-004, NFR-012; ADR-010, ADR-016.
- **Depends on:** DM-051, DM-052.
- **Deliverables:** entitlement transition service/ledger, usage debit/credit service, server guards, short-lived cache invalidation.
- **Acceptance:** subscription and entitlement update transactionally; one event yields at most one transition; durable allowance debit precedes accepted AI work; exhausted allowance never blocks account/privacy/billing; Redis loss changes no access facts.
- **Verify:** `pnpm test:integration --filter entitlements --filter usage && pnpm test:resilience --filter stripe-outage --filter redis-flush`.
- **Evidence:** _pending_

### DM-054 — Implement subscription management and reconciliation
- **Status:** TODO
- **Outcome:** Users can see/manage subscriptions and daily reconciliation repairs or alerts on provider mismatches.
- **Links:** FR-062; NFR-011, NFR-012; MVP G6; ADR-016.
- **Depends on:** DM-052, DM-053.
- **Deliverables:** subscription/entitlement routes, Customer Portal route, billing worker reconciliation job, mismatch alerts and runbook.
- **Acceptance:** status/plan/next date/cancellation timing are clear; ordinary reads never call Stripe; purchase/failure/renewal/cancel/refund scenarios converge; mismatches repair or alert within 24 hours.
- **Verify:** `pnpm test:contract --filter subscription && pnpm test:integration --filter billing-reconciliation && pnpm runbook:test -- billing-reconciliation`.
- **Evidence:** _pending_

## Epic 10 — Responsive web and React Native UX

### DM-055 — Build responsive web acquisition, identity, and billing UX
- **Status:** TODO
- **Outcome:** Next.js supports public plan/legal pages and complete web account, onboarding, privacy, support, and billing journeys.
- **Links:** FR-001–003, FR-010, FR-052, FR-060–063, FR-070–071; NFR-009, NFR-010; ADR-004.
- **Depends on:** DM-025, DM-036, DM-037, DM-051, DM-054, DM-056.
- **Deliverables:** `apps/web/` routes/components, OIDC PKCE adapter, localized strings, secure server/client boundaries.
- **Acceptance:** prices/terms match server config; required/optional consent is clear; checkout and portal use API; loading/empty/error/retry states exist; tokens/secrets never enter insecure storage/bundles; core flow meets WCAG 2.2 AA.
- **Verify:** `pnpm test --filter web && pnpm test:e2e:web && pnpm test:a11y:web && pnpm build --filter web`.
- **Evidence:** _pending_

### DM-056 — Build privacy and support API workflows
- **Status:** TODO
- **Outcome:** Users can submit/read categorized support cases and verified export/deletion workflows, while uploaded media becomes usable only after worker verification.
- **Links:** FR-001, FR-070, FR-071; NFR-005, NFR-006; MVP G5.
- **Depends on:** DM-026, DM-035, DM-049.
- **Deliverables:** `apps/api/src/modules/{privacy,support,media}/`, `apps/media-worker/`, privacy/support routes and workers, export object generation and signed download, media lifecycle tests, and named operational ownership/runbook for quarantine and S3/database inconsistency.
- **Acceptance:** high-assurance confirmation precedes requests; delete immediately revokes access and schedules all systems; statuses/exceptions are durable; export is usable and expires in 7 days; support categories route appropriately; only the media worker transitions `pending_upload` to `available` or `quarantined` after S3 `HEAD`, MIME allowlist, size, malware, and checksum verification; missing, mismatched, or unverifiable S3 objects fail closed without inconsistent database availability; no secret/raw content leaks to telemetry.
- **Verify:** `pnpm test:contract --filter privacy --filter support && pnpm test:integration --filter privacy --filter support --filter media-object-lifecycle && pnpm test:resilience --filter media-s3-consistency`.
- **Evidence:** _pending_

### DM-057 — Build web learning, tutor, and progress UX
- **Status:** TODO
- **Outcome:** Responsive web completes the deterministic daily loop, writing feedback, tutor streaming/recovery, review, and progress.
- **Links:** FR-020–024, FR-030–032, FR-040–041, FR-050, FR-052; NFR-004, NFR-009–010.
- **Depends on:** DM-040, DM-044, DM-045, DM-055.
- **Deliverables:** web curriculum/lesson/activity renderers, accessible audio, session resume, tutor/writing/review/progress screens.
- **Acceptance:** all deterministic interaction types work; progress saves/resumes; AI is labeled and safe failure is explicit; no unverified delta is rendered; completion vs proficiency is distinct; full keyboard/screen-reader/text-scaling flow passes.
- **Verify:** `pnpm test:e2e:web --filter learning && pnpm test:a11y:web && pnpm test:contract:clients`.
- **Evidence:** _pending_

### DM-058 — Build React Native shell, identity, and shared platform adapters
- **Status:** TODO
- **Outcome:** iOS/Android builds securely authenticate and consume generated API clients with accessible navigation.
- **Links:** FR-001–003, FR-010; NFR-009, NFR-010, NFR-015; ADR-005.
- **Depends on:** DM-025, DM-035, DM-036.
- **Deliverables:** `apps/mobile/`, secure-token/OIDC adapter, API composition, navigation, externalized strings, native build configuration.
- **Acceptance:** access tokens use platform secure storage; no sensitive content enters general storage; iOS/Android builds pass; account/consent/onboarding states recover; no native purchase or external web purchase CTA is included without policy approval.
- **Verify:** `pnpm test --filter mobile && pnpm mobile:typecheck && pnpm mobile:build:ios && pnpm mobile:build:android`.
- **Evidence:** _pending_

### DM-059 — Build mobile learning, tutor, review, and progress UX
- **Status:** TODO
- **Outcome:** Existing users receive the complete MVP learning experience on iOS and Android with synchronized state.
- **Links:** FR-020–024, FR-030–032, FR-040–041, FR-050, FR-052, FR-063; NFR-004, NFR-009–010.
- **Depends on:** DM-040, DM-044, DM-045, DM-058.
- **Deliverables:** mobile curriculum/lesson/activity/audio/tutor/writing/review/progress/plan-status screens.
- **Acceptance:** online deterministic loop and interruption recovery match web; entitlement is consumed from API; AI failure is safe; accessible names/focus/text scaling/non-color cues/audio transcripts pass; no offline practice, speaking, or native IAP is represented.
- **Verify:** `pnpm test:e2e:ios && pnpm test:e2e:android && pnpm test:a11y:mobile && pnpm test:contract:clients`.
- **Evidence:** _pending_

## Epic 11 — Privacy, policy, and customer operations

### DM-049 — Approve the launch data inventory and retention operations
- **Status:** TODO
- **Outcome:** Every personal-data class and transfer has an approved purpose, basis, location, access, retention, deletion, and subprocessor record.
- **Links:** FR-002, FR-024, FR-040, FR-070; NFR-006, NFR-007, NFR-016; MVP G5; ADR-017.
- **Depends on:** DM-004; must complete before production data collection.
- **Deliverables:** `docs/privacy/data-inventory.md`, `docs/privacy/retention-schedule.md`, `docs/privacy/subprocessors-and-transfers.md`, legal-document source versions, owner approvals.
- **Acceptance:** fixed database/AI retention periods are reflected; no learner content is used for model training/evals without separate specific consent; analytics excludes raw chat/writing/audio; provider safeguards and launch countries are recorded.
- **Verify:** privacy owner approval and inventory completeness check `pnpm privacy:inventory:check`.
- **Evidence:** _pending_

### DM-050 — Implement retention, erasure, and backup suppression
- **Status:** TODO
- **Outcome:** Scheduled lifecycle jobs purge eligible PostgreSQL/S3/Redis/Cognito/provider data and prevent resurrection after restore.
- **Links:** FR-070; NFR-003, NFR-006, NFR-007; ADR-010, ADR-011, ADR-017.
- **Depends on:** DM-007, DM-021, DM-049, DM-056.
- **Deliverables:** retention scheduler/workers, erasure adapters, suppression ledger/apply script, lifecycle verification reports.
- **Acceptance:** raw tutor 30d, writing 90d, provenance 400d, support 24mo, exports 7d and other contract periods are enforced; legal holds are explicit; deletion evidence contains no erased content; restores apply suppression before traffic.
- **Verify:** `pnpm test:integration --filter retention --filter erasure && pnpm test:restore:suppression`.
- **Evidence:** _pending_

## Epic 12 — Observability, reliability, and operational readiness

### DM-060 — Implement end-to-end observability and SLOs
- **Status:** TODO
- **Outcome:** Operators can trace safe identifiers across API, DB, outbox, queues, workers, AI, billing, media, and privacy.
- **Links:** NFR-001, NFR-002, NFR-007, NFR-011, NFR-013; MVP G4, G8; ADR-018.
- **Depends on:** DM-008, DM-012, DM-023, DM-044, DM-054, DM-056.
- **Deliverables:** OpenTelemetry instrumentation, structured logs, RED/queue/AI/cost/billing/privacy metrics, dashboards, synthetics, SLOs and actionable alerts under `infra/observability/`.
- **Acceptance:** 99.9% API availability and latency objectives are measurable; queue age, AI quality/cost, webhook failure, mismatch, and privacy age alert; representative telemetry contains zero prohibited raw data.
- **Verify:** `pnpm test:observability && pnpm test:telemetry-safety && pnpm slo:validate`.
- **Evidence:** _pending_

### DM-061 — Complete operational runbooks and tabletop exercises
- **Status:** TODO
- **Outcome:** Named owners can respond to incidents and safely restore/rollback every critical subsystem.
- **Links:** NFR-003–005, NFR-008, NFR-011; MVP G8; ADR-015, ADR-018, ADR-019.
- **Depends on:** DM-024, DM-048, DM-054, DM-060.
- **Deliverables:** `docs/runbooks/` for incident command, DB restore, AI outage/rollback, content rollback, queues/DLQ, Redis loss, billing reconciliation, privacy failure, key recovery; tabletop records.
- **Acceptance:** each runbook has trigger, owner, safe diagnostics, containment, recovery, validation, communication, and rollback; required tabletops complete without copying sensitive content.
- **Verify:** `pnpm runbook:lint && pnpm runbook:test --all`; signed tabletop evidence.
- **Evidence:** _pending_

## Epic 13 — Integrated verification, beta, and launch gates

### DM-062 — Complete integrated functional and accessibility testing
- **Status:** TODO
- **Outcome:** Web, iOS, and Android pass all critical journeys, failure states, authorization, contract, and WCAG checks.
- **Links:** all in-scope FRs; NFR-004, NFR-005, NFR-009, NFR-010, NFR-012; MVP G2, G5, G7.
- **Depends on:** DM-027, DM-050, DM-057, DM-059.
- **Deliverables:** `tests/e2e/`, supported browser/OS/assistive-tech matrix, accessibility manual review, cross-client resume tests.
- **Acceptance:** account-to-first-activity; lesson/resume; review; tutor; writing; progress; privacy; support; checkout/entitlement all pass where applicable; 100% owned resource types have cross-user denial; zero critical accessibility failure; no Sev-1 or blocking Sev-2.
- **Verify:** `pnpm test:e2e && pnpm test:a11y && pnpm test:contract && pnpm test:security`.
- **Evidence:** _pending_

### DM-063 — Complete load, resilience, and recovery qualification
- **Status:** TODO
- **Outcome:** Launch and 2× forecast load meet latency, availability, queue, cost, and recovery gates.
- **Links:** NFR-001–004, NFR-011–013; MVP G4; ADR-010, ADR-012, ADR-018.
- **Depends on:** DM-048, DM-054, DM-060, DM-061, DM-062.
- **Deliverables:** `tests/load/`, `tests/resilience/`, capacity/cost report, restore and Redis-loss evidence.
- **Acceptance:** core p95 <300ms and <1% server errors; first verified learner-visible delta p95 <2s and ≥98% completion excluding blocks; critical queue age within gate; AI outage remains deterministic; Redis flush loses no facts; DB RPO ≤5m; 2× capacity documented.
- **Verify:** `pnpm test:load:launch && pnpm test:load:2x && pnpm test:resilience && pnpm test:restore`.
- **Evidence:** _pending_

### DM-064 — Certify launch content and governed releases
- **Status:** TODO
- **Outcome:** One immutable production candidate contains exactly four approved six-unit modules and approved AI releases.
- **Links:** FR-020–024, FR-040–041, FR-050, FR-052, FR-072; NFR-008, NFR-014; MVP G1, G3.
- **Depends on:** DM-031, DM-033, DM-034, DM-046, DM-047, DM-063.
- **Deliverables:** final content manifest, 24-unit inventory report, reviewer approvals, AI evaluation records, rollback targets.
- **Acceptance:** 4/4 levels, 24/24 units, 100% scored-item version mapping, 100% expert approval, zero prohibited CEFR/certification claims; every AI release passes gates and has an approved rollback.
- **Verify:** `pnpm content:validate --release mvp && pnpm content:inventory --release mvp && pnpm eval:gates --all-published`.
- **Evidence:** _pending_

### DM-065 — Run moderated usability beta
- **Status:** TODO
- **Outcome:** At least 20 target adults validate first-session completion and client stability before commercial beta.
- **Links:** FR-010, FR-021–024, FR-030–032, FR-040–041, FR-071; MVP G2, G7.
- **Depends on:** DM-062, DM-064.
- **Deliverables:** beta protocol/consent, participant mix, issue log, anonymized findings and gate report under `docs/release/beta/`.
- **Acceptance:** ≥95% complete registration/level/first lesson without facilitator; median verified-account-to-activity <5m; crash-free moderated mobile sessions ≥99%; no Sev-1/blocking Sev-2; privacy-safe analytics only.
- **Verify:** signed G2/G7 evidence and defect disposition.
- **Evidence:** _pending_

### DM-066 — Run limited commercial beta
- **Status:** TODO
- **Outcome:** At least 50 target adults across A1–B2 validate activation, repeated learning, tutor usefulness, and unit economics.
- **Links:** FR-010, FR-021, FR-024, FR-031, FR-040, FR-060–063; MVP G9.
- **Depends on:** DM-010, DM-011, DM-049, DM-054, DM-060, DM-061, DM-063, DM-065.
- **Deliverables:** controlled cohort configuration, beta dashboard, survey, billing/AI cost report, incident/defect review.
- **Acceptance:** ≥70% onboarding starters begin learning; ≥60% starters finish first lesson; ≥35% first-lesson completers return within 7d; ≥70% next-step clarity and tutor usefulness ratings; projected AI variable cost ≤20% net subscription revenue.
- **Verify:** approved G9 report with metric definitions, denominators, and cohort dates.
- **Evidence:** _pending_

### DM-067 — Pass production launch review
- **Status:** TODO
- **Outcome:** Accountable owners attest that MVP gates G1–G9 pass and production promotion is safe and reversible.
- **Links:** all MVP requirements and NFR-001–016; MVP G1–G9.
- **Depends on:** DM-009, DM-010, DM-011, DM-024, DM-027, DM-048, DM-050, DM-061, DM-064, DM-066.
- **Deliverables:** completed `docs/release/evidence-template.md`, launch decision, owner sign-offs, production plan, rollback/communications checklist, app-store policy review.
- **Acceptance:** all gates pass in staging/production-like conditions; zero unresolved critical/high release blockers; production infrastructure is reproducible; storefront behavior is approved; exact AI allowance, client matrix, launch countries, and legal terms are approved; no gate is silently lowered.
- **Verify:** `pnpm ci && pnpm release:verify && pnpm infra:plan:prod`; signed launch review.
- **Evidence:** _pending_

### DM-068 — Promote and verify the first public paid release
- **Status:** TODO
- **Outcome:** The reviewed artifacts are promoted to production, smoke-tested, monitored, and rollback-ready.
- **Links:** MVP objective and G1–G9; NFR-001–016; ADR-019.
- **Depends on:** DM-067.
- **Deliverables:** production deployment record, migration/manifest hashes, synthetic and smoke evidence, post-deploy observation record.
- **Acceptance:** only approved immutable content/AI/config releases are active; web purchase and internal entitlement succeed; mobile consumption works; deterministic learning survives AI disablement; SLO/alerts are healthy; rollback remains available.
- **Verify:** `pnpm deploy:prod --promote <approved-artifact> && pnpm test:smoke:prod && pnpm release:observe`.
- **Evidence:** _pending_

## Post-MVP horizon — non-actionable

The following items are intentionally **not tasks**, have no owners/status/dependencies, and must not be implemented, scaffolded, exposed, or represented as available during MVP. Entry requires launch evidence, a product decision, contract/schema changes, and where material a superseding/new ADR.

- FR-011/FR-012: validated blueprint-led placement and recommendation override.
- FR-025: asynchronous speaking/pronunciation with separate transcript and acoustic evidence.
- FR-026: limited offline deterministic practice and synchronization.
- FR-033: opt-in reminders and non-punitive streaks.
- FR-042/FR-043: dedicated AI-feedback reporting and conversation-history controls.
- FR-051/FR-073: readiness assessment, psychometrics, appeals, and reviewer console.
- FR-064: Apple/Google native purchase and restoration adapters.
- Complete A1–B2 course breadth, speech tutor/TTS beyond approved lesson audio, additional interface languages, advanced skill-graph personalization, analytics warehouse/psychometrics, expanded canary platform, and evidence-led regional expansion.

Explicit exclusions in `docs/MVP_SCOPE.md` §7 are not a horizon or backlog. They require a new strategic decision and include certification, C1/C2, children, classrooms/B2B, social features, advertising/data sale, complex plans, alternative payment rails, full offline/AI, open course marketplace, unrestricted agent tools, EKS, and premature service extraction.
