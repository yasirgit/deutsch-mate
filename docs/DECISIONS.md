# Deutsch Mate Architecture Decision Records

**Status:** accepted decision index  
**Decision date:** 2026-07-12  
**Authority:** decisions summarize the fixed choices in `docs/architecture.md`, `docs/MVP_SCOPE.md`, and `docs/PRD.md`; detailed contracts remain authoritative in their respective documents.

## ADR lifecycle and supersession

Statuses are **Proposed**, **Accepted**, **Deprecated**, or **Superseded**. Accepted ADRs are immutable historical records. A material change requires a new numbered ADR that names the ADRs it supersedes, explains migration and rollback, and updates affected architecture, API, database, security/privacy, operational, and product documents in the same change. The old ADR is then marked **Superseded by ADR-NNN**; it is not deleted or rewritten. Minor clarifications that do not change the decision may be appended with a dated note.

## ADR-001 — Adult A1-B2 individual B2C scope

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** The initial product needs a clear audience, learning claim, and commercial boundary.

**Decision:** Target adult self-learners of German at CEFR A1-B2 with an individual B2C subscription. The MVP provides one coherent, human-approved six-unit module at each level and uses self-selected starting level. It is CEFR-aligned learning evidence, not accredited certification. Children, C1/C2, B2B tenancy, classrooms, live tutoring, and native mobile purchase are outside MVP scope.

**Consequences:** Product, data, content, age-gating, pricing, and release tests optimize for adult individual learners. Broader segments or certification claims require a new decision and validation program.

## ADR-002 — TypeScript end to end

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Shared language and contracts reduce boundary drift across clients, services, workers, and AI workflows.

**Decision:** Use strict TypeScript for Next.js web, React Native mobile, NestJS Product API and workers, LangGraph.js workflows, shared packages, and automation where practical. Validate all trust boundaries with strict runtime schemas; TypeScript types alone are insufficient.

**Consequences:** Teams share tooling and domain vocabulary, while platform-specific adapters remain necessary. CI blocks type errors, unsafe boundary casts, and schema/type drift.

## ADR-003 — pnpm workspace and Turborepo monorepo

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Web, mobile, API, workers, generated clients, and shared contracts must evolve atomically without publishing internal packages.

**Decision:** Keep applications and packages in one `pnpm` workspace orchestrated by Turborepo. Repository manifests and lockfiles pin active LTS runtimes and tool versions; no speculative fixed versions or unpinned `latest` tags are used.

**Consequences:** Atomic changes and affected-task CI are simpler. Dependency and module boundaries, deterministic task inputs/outputs, lockfile discipline, and cache safety must be enforced.

## ADR-004 — Next.js web application

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** The product needs SEO-sensitive acquisition pages, authenticated learning, account/privacy controls, and web billing.

**Decision:** Use Next.js for the responsive web application, with server rendering for SEO-sensitive pages and explicit server/client security boundaries. The web client consumes the generated Product API client.

**Consequences:** One application supports acquisition and learning, but privileged code and secrets must remain server-only. Web behavior must meet the shared OpenAPI contract and WCAG 2.2 AA.

## ADR-005 — React Native mobile clients

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** iOS and Android require shared product behavior plus native audio, accessibility, secure storage, notifications, and future purchase capabilities.

**Decision:** Use React Native for iOS and Android, with reviewed native adapters where platform capability or policy requires them. Mobile consumes generated OpenAPI clients. MVP mobile apps consume existing entitlements; native in-app purchase is post-MVP.

**Consequences:** Most product code can be shared, while platform builds and native adapters remain first-class test surfaces. Store policy must be reviewed independently from Stripe.

## ADR-006 — NestJS modular monolith plus workers

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Transactional product capabilities need strong consistency, while AI, media, billing, notifications, and similar work need independent scaling and failure isolation.

**Decision:** Build one NestJS modular Product API with capability-owned modules and PostgreSQL schemas. Run long-running or asynchronous workloads as independently scalable NestJS workers. Modules communicate through owning application services in-process and versioned events across processes; direct cross-module table writes are forbidden.

**Consequences:** The initial system avoids premature distributed-service complexity while preserving extraction boundaries. A service may be extracted only when measured ownership, scale, reliability, or deployment needs justify it.

## ADR-007 — ECS Fargate compute

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Product API and worker workloads need independent deployment and scaling without a Kubernetes operating model.

**Decision:** Deploy containerized Product API and workers on AWS ECS Fargate behind managed ingress in private application subnets. Do not adopt EKS for the initial product.

**Consequences:** AWS manages more of the compute control plane and workers can scale independently. Kubernetes-specific portability is not a goal; EKS requires demonstrated workload or platform-team need and a superseding ADR.

## ADR-008 — REST, OpenAPI, and SSE client contract

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Web and mobile require one stable client contract, while tutor output needs one-way streaming and durable recovery.

**Decision:** Expose a versioned `/v1` REST Product API specified by OpenAPI 3.1. Generate web and mobile clients from `docs/openapi.yaml`. Use Server-Sent Events only for the documented tutor stream, with durable run status as authority. Apply RFC 9457 errors, UUIDv7, idempotency keys, ETags, opaque cursors, and correlation IDs.

**Consequences:** Contract-first development and compatibility tests are mandatory. Clients never call models, Stripe, storage, databases, or workers directly. Breaking changes require a new contract version and migration plan.

## ADR-009 — PostgreSQL with Kysely and explicit SQL migrations

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Learning evidence, identity linkage, AI provenance, billing, entitlements, privacy workflows, and audit state require durable relational constraints and transactions.

**Decision:** Use Amazon RDS PostgreSQL as the system of record, initially one logical cluster with capability-owned schemas. Access it through Kysely on `node-postgres`, using parameterized SQL and PostgreSQL features where needed. Manage schema through reviewed, forward-only explicit SQL migrations; schema auto-sync/runtime DDL is forbidden. Use UUIDv7, UTC `timestamptz`, append-only evidence, RLS, optimistic locking, and a transactional outbox.

**Consequences:** The database enforces important integrity and authorization invariants. Migrations require expand/contract compatibility, empty-build and prior-snapshot upgrade tests, bounded backfills, and restore evidence. Application code cannot treat generated persistence types as API/domain contracts.

## ADR-010 — Redis is disposable acceleration

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Rate limiting, short-lived caching, locks, streaming fragments, and coordination benefit from low-latency state, but Redis loss must not lose business facts.

**Decision:** Use Redis only for reconstructable or safely expendable state with TTLs and environment/workload isolation. PostgreSQL remains authoritative for attempts, results, subscriptions, entitlements, idempotent effects, AI checkpoints, and terminal outcomes.

**Consequences:** Cache loss may reduce performance or stream-resume availability but cannot corrupt or erase durable state. A full Redis flush is a required resilience test; sensitive raw learner/provider data is not stored there.

## ADR-011 — S3 for immutable and large objects

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Media, AI trace bodies, exports, analytics objects, and integrity evidence are unsuitable for relational row storage.

**Decision:** Store large or immutable objects in private, environment-separated S3 buckets with versioning, checksums, SSE-KMS, lifecycle/retention policy, and Object Lock where required. PostgreSQL registers ownership, classification, hash, retention, and lifecycle state. Clients use short-lived purpose-bound presigned URLs and never choose object keys.

**Consequences:** Object/database lifecycle coordination and deletion of eligible versions require durable workflows. Object keys contain no direct identifiers, public access is blocked, and immutable evidence may outlive active product data under disclosed retention.

## ADR-012 — EventBridge, SQS, and transactional outbox

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Asynchronous workers require reliable cross-process delivery without distributed transactions.

**Decision:** Write domain events to a PostgreSQL transactional outbox with the business mutation, publish through EventBridge, and buffer worker delivery with SQS. Delivery is at least once; each consumer uses a PostgreSQL inbox, unique domain keys, atomic effects, bounded retries, DLQs, and replay.

**Consequences:** Effective business outcomes are once-only even when messages duplicate or reorder. Event schemas are versioned and observable. No distributed transaction spans PostgreSQL, queues, Redis, S3, Stripe, or AI providers.

## ADR-013 — Cognito and OIDC identity

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Authentication credentials and federation should be delegated while product authorization, consent, and learner state remain under product control.

**Decision:** Use Amazon Cognito through OAuth 2.0 Authorization Code with PKCE and OIDC. Validate issuer, audience, signature, expiry, and scopes on every token. Resolve the token subject to an internal user; enforce scopes, active roles, ownership, entitlements, and PostgreSQL RLS independently.

**Consequences:** Deutsch Mate stores no passwords or long-lived identity tokens. Cognito availability and lifecycle must be operationally managed, but Cognito groups/claims do not replace product authorization or audit.

## ADR-014 — LangGraph.js behind an OpenAI gateway

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Learner-facing AI needs durable workflows, strict boundaries, provider isolation, traceability, cost control, and rapid rollback.

**Decision:** Implement approved AI workflows in LangGraph.js with bounded graph topology, typed state/tools, and PostgreSQL checkpoints. Route every model call through an internal OpenAI gateway that owns credentials, structured output, routing, budgets, PII minimization, safety, retries, circuit breaking, telemetry, controlled fallback, and immutable release pins. Clients and modules never call OpenAI directly.

**Consequences:** Provider coupling is isolated and graph runs are reproducible. The gateway and graph registry are critical controls; arbitrary tools, browsing, shell/code execution, dynamic graphs, and model-selected permissions are forbidden.

## ADR-015 — AI and CEFR governance

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** AI correction and level claims can mislead learners or create safety, fairness, and learning-integrity harm.

**Decision:** AI augments, never replaces, the deterministic curriculum. Version prompts, models, graphs, policies, sources, rubrics, scoring rules, and dispositions. Require strict structured output, semantic validation, CEFR/safety verification, teacher-labeled A1-B2 regression evaluation, human release governance, controlled rollout, kill switches, and immutable rollback. Failed or unverifiable AI creates no mastery evidence. Placement/readiness scoring and certification remain outside MVP.

**Consequences:** AI releases are slower and evidence-heavy but auditable and reversible. Deterministic learning remains available during AI outages. Consequential CEFR capabilities require approved blueprints, qualified human and psychometric governance, appeals, and a separate release decision.

## ADR-016 — Stripe Checkout/Billing with internal entitlements

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Web subscriptions need a low-PCI payment surface, while product access must tolerate provider delays and future mobile billing providers.

**Decision:** Use Stripe-hosted Checkout in subscription mode and Stripe Billing/Customer Portal for web. Verify signed webhook raw bodies, persist provider events once, process idempotently, reconcile on schedule, and update subscriptions plus provider-agnostic internal entitlements transactionally. Ordinary product requests read PostgreSQL entitlements and never call Stripe synchronously. Do not store card data.

**Consequences:** Provider event disorder and reconciliation are first-class test cases. Redirect success is not proof of access. Apple, Google, and manual sources can map to the same entitlement model later without making Stripe the product authorization system.

## ADR-017 — EU-first privacy and security

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** The product handles identity, learner writing/chat, AI traces, billing references, and learning evidence for EU-first users.

**Decision:** Launch in an EU primary AWS region and apply GDPR purpose limitation, minimization, lawful-basis/consent history, data inventory, explicit retention, export/deletion, transfer/subprocessor inventory, encryption, least privilege, RLS, secrets management, signed media, abuse controls, and integrity-protected audit. Use the strongest approved no-training/retention controls for model providers. Standard telemetry excludes unrestricted learner content and secrets.

**Consequences:** Every data flow needs classification, purpose, location, access, retention, deletion, and transfer behavior before release. International providers require documented safeguards. Privacy/security findings and prohibited-data telemetry are release-blocking at the thresholds in MVP gates.

## ADR-018 — Observability and initial SLOs

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Operators must trace synchronous and asynchronous failures while protecting sensitive learner data and measuring launch reliability.

**Decision:** Use OpenTelemetry-compatible traces, structured redacted logs, RED metrics for services, queue/worker metrics, synthetic checks, dashboards, and actionable alerts. Propagate request, correlation, causation, trace, run, and attempt identifiers across API, outbox, queues, workers, gateway, and storage operations. Initial objectives are 99.9% monthly Product API availability, core API p95 below 300 ms, tutor first verified learner-visible delta p95 below 2 seconds under documented launch load, transactional RPO at most 5 minutes, and initial RTO target of 4 hours.

**Consequences:** SLOs, queue age, AI quality/cost, billing mismatches, privacy request age, and recovery are tested and reviewed. Telemetry design must avoid raw chat, writing, audio, credentials, provider payloads, and signed URLs. Threshold changes require evidence and owner approval, not silent relaxation.

## ADR-019 — Infrastructure as code and environment isolation

**Status:** Accepted  
**Date:** 2026-07-12

**Context:** Development, staging, and production require reproducible infrastructure, least privilege, and protection from cross-environment data or credential leakage.

**Decision:** Provision AWS infrastructure through one repository-approved IaC toolchain (AWS CDK or Terraform, selected and pinned by repository implementation) with reviewed plans. Use separate development, staging, and production AWS accounts; separate networking, data stores, buckets, queues, keys, secrets, identities, observability, and Stripe credentials. Production compute/data remain in private subnets across multiple availability zones in the EU primary region.

**Consequences:** No environment shares mutable state or credentials. Production changes require reviewed IaC and auditable deployment roles; console drift is detected and reconciled through code. Backup/restore, deletion suppression, key recovery, and disaster exercises cross account boundaries. Choosing CDK versus Terraform is an implementation ADR once repository bootstrapping selects one; both are not used concurrently for the same resources.
