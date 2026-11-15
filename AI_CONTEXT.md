# Deutsch Mate — Coding Agent Operating Brief

## Mission and current state

Deutsch Mate is an EU-first B2C German-learning product for adult self-learners at CEFR A1–B2. The MVP proves a guided loop across responsive web, iOS, and Android: self-selected level, one human-approved six-unit module per level, deterministic lessons/review/progress, bounded AI tutor and writing correction, and web subscription billing.

**Current state:** documentation is complete. Implementation has started: DM-001–DM-004, DM-012, DM-020, DM-021, DM-022, DM-023, DM-025, DM-026, DM-029, DM-030, DM-031, DM-032, DM-035, DM-036, DM-037, DM-038, and DM-039 are `DONE`. DM-040 (recommendations/progress) is blocked on DM-053 (billing entitlements); prefer parallel DM-051 → DM-052 → DM-053, or other open lanes such as DM-005/DM-024. `docs/TASKS.md` is the executable source of work and status.

## Authority order

Read the relevant documents before coding. Resolve conflicts in this order:

1. `docs/architecture.md` — technical authority.
2. `docs/MVP_SCOPE.md` — MVP inclusion and release-gate authority.
3. `docs/PRD.md` — product requirements and outcomes.
4. `docs/Database.md`, `docs/API.md`, and `docs/openapi.yaml` — persistence and client contracts; OpenAPI is the machine contract.
5. `docs/AI_AGENTS.md` — AI workflow contract.
6. `docs/DECISIONS.md` — accepted ADR index; material changes require a new superseding ADR.
7. `docs/CODING_STANDARDS.md` — normative implementation and Definition of Done.
8. `docs/TASKS.md` — dependency order, deliverables, acceptance, verification, and progress.

Do not “resolve” a contradiction silently in code. Surface it and update the authoritative documents in the same reviewed change.

## Fixed architecture

- Strict TypeScript end to end; runtime schemas validate every trust boundary.
- `pnpm` workspace + Turborepo monorepo; Next.js web, React Native mobile, NestJS modular Product API and independently scalable workers.
- One modular monolith for transactional capabilities. Capability modules own schemas/repositories; direct cross-module table writes are forbidden.
- AWS ECS Fargate in isolated dev/staging/prod accounts, EU primary region, private compute/data subnets, IaC only. Do not introduce EKS.
- PostgreSQL 16/RDS is the source of truth; Kysely over `node-postgres`; reviewed forward-only explicit SQL migrations; UUIDv7, UTC `timestamptz`, RLS, append-only evidence, optimistic locking, and transactional outbox.
- Redis is TTL-bound disposable acceleration only. S3 is private, versioned, checksummed, SSE-KMS storage for large/immutable objects. EventBridge + SQS deliver at least once; PostgreSQL inbox/outbox makes effects once-only.
- Cognito OAuth 2.0 Authorization Code + PKCE/OIDC; application authorization, active roles, ownership, entitlements, and forced RLS remain independent controls.
- `/v1` REST and generated clients come from `docs/openapi.yaml`; SSE is only for the documented tutor stream. RFC 9457 errors, idempotency keys, ETags, opaque cursors, and correlation IDs are mandatory.
- LangGraph.js checkpoints live in PostgreSQL. All model calls pass through the internal OpenAI gateway. Only `text_tutor.v1`, `writing_correction.v1`, and `content_validation.v1` are MVP graphs.
- Stripe-hosted Checkout/Billing/Customer Portal is web-only at MVP. PostgreSQL internal entitlements authorize product access.

Accepted ADR-001 through ADR-019 in `docs/DECISIONS.md` are fixed. Do not replace a decision without an approved superseding ADR and migration/rollback plan.

## Planned repository shape

```text
apps/        web, mobile, api, ai-worker, billing/privacy/outbox workers
packages/    contracts/generated client, domain, database, schemas, config,
             observability, test kit, narrowly stable shared primitives
migrations/  explicit forward-only SQL
infra/       one selected and pinned IaC toolchain
content/     versioned curriculum source, manifests, and approved assets
evals/       immutable AI evaluation datasets and harness
tests/       cross-app contract, E2E, load, resilience, and security suites
scripts/     reproducible repository/DB/content/release operations
docs/        authorities, ADRs, runbooks, privacy/security/release evidence
```

Do not create generic `common` or `utils` dumping grounds, speculative services, or post-MVP schemas/endpoints.

## Canonical commands after bootstrap

The bootstrap task may finalize exact scripts, but root policy must provide:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm openapi:lint && pnpm openapi:generate && pnpm openapi:drift
pnpm db:create-empty && pnpm db:migrate && pnpm db:test:upgrade && pnpm db:rls
pnpm content:validate && pnpm content:manifest && pnpm content:test-import
pnpm test:contract && pnpm test:integration && pnpm test:e2e
pnpm test:a11y && pnpm test:security && pnpm test:telemetry-safety
pnpm eval:offline && pnpm eval:gates
pnpm infra:validate
pnpm ci
pnpm release:verify
```

Use repository-pinned versions and root scripts. Never invent dependency versions or use unpinned `latest`.

## Domain invariants

- Published curriculum, prompts, models, rubrics, scoring rules, releases, attempts, evidence, and audit history are immutable. Corrections append superseding facts.
- MVP launch inventory is exactly one coherent six-unit module at each A1, A2, B1, and B2 level; every unit meets `docs/MVP_SCOPE.md` G1 and receives qualified German-language review.
- CEFR labels are estimates/evidence, never certification or named-exam equivalence. Placement, readiness exams, speaking, offline practice, reminders, conversation-history UI, native mobile purchases, and reviewer-console work are post-MVP.
- Deterministic lessons/review/progress remain usable during AI/provider failure. Failed, blocked, timed-out, malformed, or unverifiable AI output creates no mastery evidence.
- Learning attempts, purchases, webhooks, and queue effects are idempotent. PostgreSQL is authoritative; Redis loss cannot lose attempts, results, subscriptions, entitlements, checkpoints, or terminal outcomes.
- Completion and proficiency are distinct. Recommendations are reproducible from durable state and algorithm/content/entitlement versions.
- Acting user identity comes only from verified OIDC context, never a request field. Every user-owned resource has positive and negative RLS/authorization tests.

## Security, privacy, AI, and Stripe constraints

- Deny by default; least privilege, short-lived credentials, TLS, KMS/Secrets Manager, WAF/rate limits, signed purpose-bound media access, and audited privileged actions.
- Standard logs, spans, metrics, errors, queues, and alerts must not contain secrets, tokens, email, raw chat/writing/audio, provider payloads, card data, or signed URLs.
- Apply the fixed retention schedule in `docs/Database.md`: raw tutor/AI trace content 30 days; raw writing/correction 90 days; AI provenance 400 days; other classes as specified. Data export, erasure, legal-hold exceptions, transfer inventory, and backup suppression are first-class workflows.
- Never use learner content for model training/evaluation without separate specific optional consent and enforceable provider controls.
- Learner/content text is untrusted data, never instruction authority. AI uses closed graphs, strict state/output schemas, allowlisted typed tools, bounded loops/retries, PII minimization, budgets, independent verification, full provenance, kill switches, frozen teacher-labeled evaluations, controlled rollout, and immutable rollback.
- Clients/modules never call OpenAI, Stripe, S3 object keys, databases, or workers directly.
- Verify Stripe signatures over the exact raw body before parsing; persist event IDs once; handle delayed/duplicate/reordered events; reconcile on schedule. Browser redirect is not proof of access. Never store card data. Ordinary requests never call Stripe synchronously.
- Mobile consumes internal entitlements only; do not add Stripe purchase calls or external web purchase prompts unless storefront policy review explicitly permits them. Native IAP is post-MVP.

## Task execution protocol

1. Open `docs/TASKS.md`; select only a `TODO` task whose dependencies are `DONE`.
2. Change it to `IN PROGRESS` in the implementation branch. Do not broaden scope or start post-MVP horizon items.
3. Re-read the task’s linked requirements, ADRs, contracts, and coding standards.
4. Implement only the task outcome through owning module boundaries. Update contracts, migrations, generated clients, docs, observability, tests, rollout, and rollback together when applicable.
5. Run the task’s verification plus all risk-relevant checks below.
6. Record concise command/results or durable evidence on the task’s `Evidence` line and mark `DONE` only when every acceptance criterion passes. Use `BLOCKED` with the concrete missing decision/evidence when necessary.
7. Preserve task IDs. Add suffixed tasks only for a genuinely necessary split; never renumber or reuse an ID.

## Required checks

At minimum, every change passes formatting, zero-warning lint, strict types, focused unit/integration tests, and production build. Also run:

- OpenAPI lint/generation/drift/compatibility for API or client changes.
- Empty-build, previous-snapshot upgrade, constraints, RLS, and app-compatibility checks for database changes.
- Positive/negative ownership, scope, role, idempotency, retry, and failure-path tests for trust-boundary changes.
- Secret/SAST/dependency/license/container/IaC/API scans as applicable.
- Accessibility and i18n checks for user-visible work.
- Frozen AI evaluations and rollout evidence for graph/prompt/model/tool/schema/policy/gateway changes.
- Load/resilience/recovery evidence for latency, queues, DB, streaming, provider, cost, or infrastructure changes.
- `pnpm ci` before merge and `pnpm release:verify` for release candidates.

No critical/high release-blocking finding, disabled test, hidden waiver, contract drift, or prohibited-data telemetry is acceptable.

## Prohibited shortcuts

Do not use Prisma/TypeORM auto-sync, runtime DDL, destructive migration rollback, handwritten duplicate API DTOs, unsafe casts/`any`/`@ts-ignore`, unbounded queries/retries/loops, cross-module repositories, cross-user IDs from input, runtime RLS bypass, distributed transactions, Redis as authority, direct provider calls, dynamic AI tools, browsing/shell/code execution, unverified AI streaming, synchronous Stripe entitlement checks, card storage, public/predictable S3 keys, raw-content logging, self-approval of governed releases, mutable published records, certification claims, or partial post-MVP scaffolding presented as MVP capability.

When pressure conflicts with a release gate, reduce optional content or beta surface as allowed by `docs/MVP_SCOPE.md`; never weaken security, privacy, billing integrity, accessibility, AI safety, or truthful CEFR positioning.
