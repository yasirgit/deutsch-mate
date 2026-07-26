# Deutsch Mate MVP Scope

**Release:** First public paid release  
**Requirement source:** `docs/PRD.md`  
**Technical authority:** `docs/architecture.md`  
**Target:** Adult self-learners, CEFR A1-B2, EU-first B2C subscription

## 1. MVP objective

Validate that adult self-learners will repeatedly use and pay for a guided, CEFR-aligned German learning loop that combines a structured curriculum with useful AI tutoring.

The MVP must prove four things:

1. A learner can enter at a self-selected A1-B2 level and quickly reach an appropriate activity.
2. A learner can complete a deterministic lesson, receive safe AI-supported practice, and get a credible next recommendation.
3. Progress persists across responsive web and React Native mobile clients.
4. A web subscriber can purchase, manage, and reliably receive premium access.

MVP does not mean a complete A1-B2 language course or a certification product. It is a production-quality, commercially usable vertical slice at each supported level.

## 2. Scope rules

- `docs/architecture.md` remains authoritative for infrastructure, persistence, security, AI, assessment, and billing design.
- Requirement IDs in this document refer to `docs/PRD.md` and must not be renumbered locally.
- **In scope** means required for the first public paid release unless explicitly marked as a controlled beta.
- **Post-MVP** means planned after launch evidence justifies the investment.
- **Excluded** means intentionally outside the product boundary; it requires a new product decision, not backlog promotion.
- If a release gate fails, scope is reduced by removing an optional content slice or controlled-beta surface. Security, privacy, billing integrity, accessibility, and truthful CEFR positioning are not negotiable.

## 3. Release experience

### Supported clients

- **Web:** Next.js public pages, account and billing flows, and the complete MVP learning experience.
- **iOS and Android:** React Native learning clients for account access, onboarding, lessons, deterministic review, tutor use, and progress synchronization.
- **Mobile commerce:** Existing subscribers can sign in and use entitlements. The apps will not display an external web purchase call to action unless storefront policy review explicitly permits it. Native in-app purchase is post-MVP.
- **Admin operations:** Minimal protected operational interfaces or scripts for approved staff; no general teacher portal.

### Launch content

The MVP launches with a deliberately bounded, human-approved curriculum slice:

- A1, A2, B1, and B2 are all selectable and represented.
- Each level contains at least **one coherent module of 6 units**.
- Each unit contains stated CEFR-linked objectives, explanation and examples, at least 12 deterministic practice interactions, one listening activity, one short writing task, and one scored formative check.
- Across each level module, content covers vocabulary, grammar, reading, listening, and writing. Speaking production is post-MVP.
- Content is reviewed by at least one qualified German-language expert before publication.
- The product labels this as an initial learning path and does not imply complete level coverage.

This boundary is sufficient to test the learning loop across A1-B2 while avoiding a false claim that completing the MVP content demonstrates completion of an entire CEFR level.

### Packaging

- **Free:** registration, onboarding, all four level previews, the first unit of the selected level, deterministic review for unlocked content, progress controls, and a configurable limited tutor allowance.
- **Premium:** all released MVP units, AI tutor use and writing feedback under a disclosed configurable fair-use allowance, and synchronized progress.
- **Working price:** EUR 14.99 monthly or EUR 119.99 annually, subject to pre-launch market, tax, and consumer-law validation.
- No launch trial, family plan, lifetime plan, or multi-tier paid packaging.

## 4. In-scope functional requirements

### 4.1 Identity, consent, and learner setup

| Requirement | MVP delivery |
|---|---|
| **FR-001** | Email-based account registration, sign-in, sign-out, recovery, and account deletion using Cognito/OIDC. Federated social identity is optional, not a gate. |
| **FR-002** | Versioned terms and privacy acceptance plus separate optional marketing consent and withdrawal. |
| **FR-003** | Goal, self-selected A1-B2 level, study cadence, interface locale, and learner preferences; versioned proficiency state. |
| **FR-010** | Resumable onboarding that reaches a self-selected level and first recommended unit. |

**MVP acceptance**

- A new user can verify an account, accept required terms, select a level and goal, and start the first activity.
- Optional questions and marketing consent can be skipped.
- Onboarding state survives closing the client and continues on another supported client.
- The release does not infer placement from an unvalidated chat or informal LLM judgment.

### 4.2 Curriculum, lessons, and practice

| Requirement | MVP delivery |
|---|---|
| **FR-020** | Immutable, versioned A1-B2 launch modules with objectives, prerequisites, skills, and CEFR can-do mappings. |
| **FR-021** | Resumable lessons with explanation, examples, selection, matching, ordering, cloze, and bounded typed-response exercises. |
| **FR-022** | Human-approved listening activities with accessible controls, deterministic scoring, and configured transcript timing. |
| **FR-023** | Objective-linked contextual vocabulary and grammar activities with answer rationale. |
| **FR-024** | Short writing submission, structured AI correction, explanation, and learner retry; failed verification produces no mastery evidence. |
| **FR-050** | Objective-linked formative checks with versioned answer keys or bounded rubrics. |
| **FR-052** | Consistent “CEFR-aligned” and “estimated evidence” language with no certification claim. |

**MVP acceptance**

- The launch content inventory meets the minimum in Section 3 at all four levels.
- Every scored activity resolves to exact curriculum, item, answer-key or rubric, and algorithm versions.
- Progress is saved after each scored activity and resumes without duplicate attempts.
- All required lesson and deterministic practice content remains usable during an AI outage.
- AI writing feedback records provenance, passes the release verifier, and provides an explicit unavailable state on failure.

### 4.3 Review, recommendations, and progress

| Requirement | MVP delivery |
|---|---|
| **FR-030** | Versioned review scheduling for vocabulary, grammar, and eligible prior mistakes. |
| **FR-031** | One primary next lesson or review recommendation based on prerequisites, recent evidence, due review, and entitlement. |
| **FR-032** | Dashboard separating module completion, recent activity, review status, and objective-level learning evidence. |

**MVP acceptance**

- A completed eligible activity creates durable evidence and, when applicable, a future review item.
- The recommendation can be reproduced from its recorded algorithm version and durable learner state.
- A free user who encounters locked content receives an unlocked alternative or clear plan information.
- The progress dashboard does not derive or claim a full CEFR level from the bounded MVP module.

### 4.4 AI tutor

| Requirement | MVP delivery |
|---|---|
| **FR-040** | Streamed text tutor for explanation, examples, guided practice, and retries, grounded in selected level and current unit. |
| **FR-041** | Internal AI gateway, allowlisted tools, bounded LangGraph.js workflow, PII minimization, CEFR/safety verifier, timeout and fallback states. |

**MVP acceptance**

- Tutor clients call only the Product API and never a model provider directly.
- The tutor uses only necessary profile, unit, recent-mistake, and entitlement context.
- Each response is traceable to feature, prompt, model, tools, verifier outcome, latency, token usage, estimated cost, and disposition.
- Unsafe, invalid, timed-out, or unverifiable output is blocked or clearly fails; it is not treated as learning mastery.
- AI unavailability leaves the curriculum and deterministic practice loop usable.

### 4.5 Subscription and access

| Requirement | MVP delivery |
|---|---|
| **FR-060** | Free and Premium plan display with final price, billing period, taxes where known, renewal, cancellation, and limits. |
| **FR-061** | Stripe Checkout and Billing for web, signed webhook ledger, idempotent processing, and internal entitlements. |
| **FR-062** | Subscription status, next billing date, plan, cancellation/management path, and scheduled reconciliation. |
| **FR-063** | Server-enforced free content and AI allowance with privacy, account, and billing controls always accessible. |

**MVP acceptance**

- Stripe test and production-like scenarios cover success, abandonment, payment failure, delayed event, duplicate event, reordered event, cancellation, renewal, and refund/credit state where supported.
- No Deutsch Mate service stores card details.
- One provider event produces at most one effective entitlement transition.
- Entitlement checks do not synchronously call Stripe during ordinary product requests.
- Reconciliation detects mismatches and either repairs them or creates an actionable alert within 24 hours.
- Mobile clients consume internal entitlements without assuming Stripe satisfies app-store payment rules.

### 4.6 Privacy, support, and release operations

| Requirement | MVP delivery |
|---|---|
| **FR-070** | Privacy notice, optional-consent controls, durable export request, and account/data deletion workflow. |
| **FR-071** | Accessible categorized support contact for account, learning, privacy, and billing issues. |
| **FR-072** | Protected versioning, approval, publication, audit, and rollback for curriculum, prompts, rubrics, and model configuration. |

**MVP acceptance**

- The launch data inventory defines purpose, lawful basis, location, retention, subprocessor, and deletion behavior for every personal-data class.
- Raw chat, writing, audio if collected incidentally, and AI trace content have approved retention periods before production collection.
- A staged export and deletion request completes end to end and leaves an auditable status.
- Draft content and prompt configurations are inaccessible to learner clients.
- A previous approved content or AI configuration can be restored while historical attempts retain original provenance.

## 5. In-scope non-functional requirements

All PRD non-functional requirements are release requirements, with these MVP interpretations:

| Requirement | MVP release interpretation |
|---|---|
| **NFR-001** | 99.9% monthly Product API availability target, measured by external synthetic checks. |
| **NFR-002** | Core API p95 below 300 ms and tutor first verified learner-visible delta p95 below 2 seconds under launch load. |
| **NFR-003** | PostgreSQL source of truth, Multi-AZ, PITR, cross-account backup, RPO at most 5 minutes, and completed restore exercise. |
| **NFR-004** | Account access, released curriculum, deterministic practice, review, and durable progress remain operational during simulated AI outage. |
| **NFR-005** | Threat model, least privilege, encryption, secrets management, signed media, abuse controls, audit logs, and zero unresolved critical/high release-blocking findings. |
| **NFR-006** | GDPR data inventory, consent history, export/deletion, retention schedules, EU primary region, and international transfer inventory. |
| **NFR-007** | Full AI trace provenance with shorter approved retention for raw sensitive content. |
| **NFR-008** | Teacher-labeled A1-B2 golden evaluation and prompt/model release thresholds defined in Section 8. |
| **NFR-009** | WCAG 2.2 AA checks on all core web/mobile, account, learning, progress, and billing journeys. |
| **NFR-010** | Published browser/OS matrix, generated OpenAPI clients, and passing contract tests for Next.js and React Native. |
| **NFR-011** | Correlated logs, traces, RED/queue metrics, dashboards, alerts, and no unrestricted learner content in standard telemetry. |
| **NFR-012** | Duplicate/reordered tests for attempts, billing webhooks, and queue consumers produce one effective outcome. |
| **NFR-013** | Launch-load and 2x forecast tests for Product API and AI workers, including queue, database, and cost behavior. |
| **NFR-014** | Immutable released curriculum, prompts, rubrics, scoring rules, and historical version resolution. |
| **NFR-015** | TypeScript end to end: Next.js, React Native, NestJS, LangGraph.js; CI runs format, lint, type, test, migration, dependency, and security checks. |
| **NFR-016** | Isolated development/staging/production AWS environments in an EU primary region, provisioned through infrastructure as code. |

## 6. Post-MVP scope

Post-MVP items are not required to launch and must not be partially represented as available.

| Requirement | Planned capability | Entry condition |
|---|---|---|
| **FR-011** | Blueprint-led placement assessment with approved item pools and versioned scoring. | Sufficient validated items and teacher review capacity exist across A1-B2. |
| **FR-012** | Learner override of a formal placement recommendation. | FR-011 is released. Self-selection remains available in MVP. |
| **FR-025** | Asynchronous speaking and pronunciation practice with transcript and acoustic evidence. | Audio privacy retention, native recording UX, speech evaluation, and processing reliability pass gates. |
| **FR-026** | Cached limited offline deterministic practice and idempotent synchronization. | Online mobile learning stability and synchronization semantics are proven. |
| **FR-033** | Opt-in reminders and non-punitive streaks. | Baseline retention exists and notification consent/platform behavior is validated. |
| **FR-042** | In-product AI feedback reporting and reviewer aggregation. | MVP uses categorized support with trace references; volume justifies dedicated workflow. |
| **FR-043** | Learner-visible tutor conversation history and per-conversation deletion controls. | Retention and deletion design passes privacy review. MVP may keep only current-session display. |
| **FR-051** | Controlled level-readiness assessments with generated candidates, human release gates, multi-pass productive scoring, psychometrics, and appeals. | Validated blueprint, reviewer operations, fairness evidence, and psychometric sample requirements are met. |
| **FR-064** | Apple and Google native in-app purchase, restoration, and provider reconciliation. | Store policy and commercial review complete; entitlement integration passes sandbox testing. |
| **FR-073** | Dedicated assessment reviewer console. | FR-051 implementation begins and reviewer workflow is approved. |

Other post-MVP investments:

- Complete course breadth for each A1-B2 level beyond the launch modules.
- Speech-enabled tutor conversations and text-to-speech beyond approved lesson audio.
- Additional interface/explanation languages.
- Advanced personalization using a curriculum skill graph and broader proficiency vector.
- Analytics warehouse and psychometric outcome reporting beyond operational launch analytics.
- Prompt/model canary platform beyond the required controlled MVP rollout mechanism.
- Regional expansion when residency or latency evidence requires it.

## 7. Explicit exclusions

These items are not backlog candidates for the MVP product without a new strategic decision:

- Accredited certificates, official CEFR certification, remote proctoring, or equivalence claims to named examination providers.
- CEFR C1 or C2 curriculum and assessment.
- Children as a target audience, child accounts, or parent/guardian product flows.
- Live tutoring, teacher-led classes, tutor marketplace, classroom management, or institutional reporting.
- B2B organization tenancy, seat management, invoicing, or enterprise SSO.
- Learner social network, direct messaging, public profiles, leaderboards, or competitive multiplayer.
- Advertising, sale of learner data, or training external models on learner content by default.
- Lifetime plans, family plans, gifting, scholarships, or complex promotional billing.
- Cryptocurrency or alternative payment rails.
- Full offline courses, offline AI, or offline consequential assessment.
- User-authored public courses or an open content marketplace.
- Unrestricted general-purpose chatbot tools, web browsing, or arbitrary code execution.
- Kubernetes/EKS, multi-region active-active operation, or premature service extraction without measured need.

No PRD requirement ID is assigned to exclusions that are product non-goals. **FR-051** remains post-MVP only as a non-accredited readiness capability.

## 8. Measurable release gates

All gates below must pass in staging or production-like conditions. Evidence is retained in the release record.

### Gate G1 — Scope and content completeness

- 4/4 levels contain at least 1 approved module of 6 units.
- 24/24 units have CEFR-linked objectives, prerequisites, explanation/examples, at least 12 deterministic interactions, one listening activity, one writing task, and one formative check.
- 100% of released scored items map to an immutable content version and answer key or rubric.
- 100% of released units receive recorded approval from a qualified German-language expert.
- Product copy review finds zero certification or named-exam equivalence claims.

**Mapped requirements:** FR-020-024, FR-050, FR-052, NFR-014.

### Gate G2 — Critical journey completion

In supported-client end-to-end tests:

- Account-to-first-activity flow passes on web, iOS, and Android.
- Lesson complete/resume, due review, tutor, writing feedback, progress, and support flows pass on all applicable clients.
- At least 95% of a 20-person moderated beta can complete registration, level selection, and first lesson without facilitator intervention.
- Median verified-account-to-first-activity time is below 5 minutes when using level self-selection.
- Zero severity-1 defects remain; zero known severity-2 defects block account, learning evidence, privacy, or payment.

**Mapped requirements:** FR-001-003, FR-010, FR-021-024, FR-030-032, FR-040-041, FR-071, NFR-009-010.

### Gate G3 — AI linguistic quality and safety

On a frozen, teacher-labeled A1-B2 golden set containing at least 100 cases per level and covering explanation, correction, guided practice, common learner errors, and adversarial prompts:

- At least 95% of outputs are rated linguistically correct or acceptable.
- At least 90% are rated appropriate for the requested CEFR level.
- Material correction-error rate is at most 3%.
- Unsafe release rate on the adversarial subset is 0%; over-refusal rate is at most 5% on the safe subset.
- Structured-output and verifier pass rate is at least 99%; failed cases produce the designed safe failure state.
- Every released prompt/model configuration has a recorded evaluation and rollback target.

Thresholds are initial launch assumptions and require sign-off from the accountable language-quality and safety owners.

**Mapped requirements:** FR-024, FR-040-041, FR-072, NFR-007-008.

### Gate G4 — Reliability and recovery

Under representative launch load and a documented 2x forecast:

- Core API p95 server latency is below 300 ms with less than 1% server-error rate.
- Tutor first verified learner-visible delta p95 is below 2 seconds and completed-response success is at least 98%, excluding intentionally blocked requests.
- No critical queue exceeds a 5-minute oldest-message age for more than 10 continuous minutes under normal load.
- A simulated AI-provider outage leaves deterministic learning available and produces no false mastery evidence.
- Database point-in-time restore is demonstrated with an achieved RPO of at most 5 minutes and documented recovery time.
- A Redis-loss exercise causes no loss of attempts, subscriptions, entitlements, or results.

**Mapped requirements:** NFR-001-004, NFR-011, NFR-013.

### Gate G5 — Security and privacy

- Threat models for identity, cross-user authorization, AI prompt injection, learner content, uploads, and billing webhooks are approved.
- Automated dependency, secret, static analysis, and dynamic API checks report zero unresolved critical or high release-blocking findings.
- Cross-user authorization tests cover 100% of user-owned API resource types.
- Staging data export and deletion requests complete end to end with statuses and disclosed retention exceptions.
- 100% of personal-data classes have purpose, lawful basis, location, retention, subprocessor, access, and deletion entries.
- Standard logs and analytics contain zero raw chat, unrestricted writing, credentials, payment details, or signed media URLs in a representative test capture.
- Required consent versions and optional-consent withdrawal are verified on all clients.

**Mapped requirements:** FR-001-002, FR-040-041, FR-070, NFR-005-007, NFR-011, NFR-016.

### Gate G6 — Billing and entitlement integrity

- Test coverage passes purchase, abandonment, payment failure, renewal, cancellation, duplicate webhook, reordered webhook, delayed webhook, refund/credit state where supported, and reconciliation.
- Duplicate/reordered provider events result in exactly one effective entitlement outcome in 100% of test cases.
- The product stores zero card details.
- An entitlement mismatch is detected by scheduled reconciliation within 24 hours and produces a repair or actionable alert.
- Pricing, recurring terms, cancellation, and plan entitlements match configuration on every purchase surface.
- App-store policy review documents allowed iOS and Android MVP behavior before submission.

**Mapped requirements:** FR-060-063, NFR-005, NFR-012.

### Gate G7 — Accessibility and compatibility

- Independent or designated accessibility review finds zero critical WCAG 2.2 AA failures in registration, onboarding, lesson, tutor, progress, privacy, support, and web billing.
- Keyboard/switch navigation, screen-reader semantics, focus order, contrast, text scaling, audio controls, transcripts, and non-color cues pass on the published matrix.
- OpenAPI contract tests pass for Next.js web and both React Native platform builds.
- Crash-free moderated beta sessions are at least 99% across supported mobile OS versions.

**Mapped requirements:** FR-021-024, NFR-009-010.

### Gate G8 — Operations and launch control

- Production infrastructure is reproducible from reviewed infrastructure as code.
- Dashboards and actionable alerts cover availability, latency, queue age, AI failures/cost, webhook failures, entitlement mismatches, and privacy request age.
- Incident, AI rollback, content rollback, billing reconciliation, and database restoration runbooks have named owners and completed tabletop exercises.
- CI passes formatting, linting, TypeScript checks, unit/integration/end-to-end tests, migration checks, dependency checks, and infrastructure validation.
- Product API and workers run in isolated production infrastructure in the EU primary region.

**Mapped requirements:** FR-072, NFR-003, NFR-005, NFR-008, NFR-011, NFR-015-016.

### Gate G9 — Commercial beta evidence

Before broad paid acquisition, a limited beta of at least 50 target adults, including representation at all four selected levels, must show:

- At least 70% of users who start onboarding begin a learning activity.
- At least 60% of starters complete a first lesson.
- At least 35% of first-lesson completers return and complete another successful learning session within 7 days.
- At least 70% of surveyed lesson completers rate “I knew what to study next” at 4 or 5 on a 5-point scale.
- At least 70% of surveyed tutor users rate the feedback as useful at 4 or 5 on a 5-point scale.
- AI variable cost at the configured Premium allowance is forecast not to exceed 20% of net subscription revenue at the working monthly price.

Failure of a product-value threshold requires product/content iteration before broad acquisition. It does not authorize lowering quality, privacy, security, or billing gates.

**Mapped requirements:** FR-010, FR-021, FR-024, FR-031, FR-040, FR-060-063; PRD metrics.

## 9. Post-launch success thresholds

The MVP is considered validated after the first cohort has had 8 weeks of availability and the sample is large enough for directional use:

- D7 learning retention of at least 30% among users who complete a first lesson.
- At least 1.5 Weekly Successful Learning Sessions per weekly active learner.
- At least 25% of activated free users encounter and understand a Premium value moment; conversion target is measured separately by acquisition source.
- Checkout-to-entitlement success of at least 99.5%.
- Subscription/provider unresolved mismatch rate below 0.1% after reconciliation.
- Confirmed material AI correction error rate remains at or below 3% on reviewed samples.
- AI variable cost remains at or below 20% of net subscription revenue.
- No overdue privacy request and no unresolved severity-1 security, privacy, learning-integrity, or billing incident.

These are validation thresholds, not guarantees of learning outcomes or CEFR advancement.

## 10. Requirement disposition summary

### In scope

- **Functional:** FR-001, FR-002, FR-003, FR-010, FR-020, FR-021, FR-022, FR-023, FR-024, FR-030, FR-031, FR-032, FR-040, FR-041, FR-050, FR-052, FR-060, FR-061, FR-062, FR-063, FR-070, FR-071, FR-072.
- **Non-functional:** NFR-001 through NFR-016.

### Post-MVP

- FR-011, FR-012, FR-025, FR-026, FR-033, FR-042, FR-043, FR-051, FR-064, FR-073.

### Excluded

- No requirement IDs are marked excluded because PRD requirements define intended product capabilities. Strategic non-goals are listed in Section 7.

## 11. Assumptions requiring confirmation

- English is the initial interface and explanation language; German is the learning language.
- The MVP launches one 6-unit module per A1-B2 level rather than claiming full level completion.
- Users self-select their starting level until validated placement is available.
- Web is the only purchase channel at MVP; mobile applications are consumption clients for existing entitlements and comply with documented storefront policy.
- The working prices are EUR 14.99 monthly and EUR 119.99 annually; tax-inclusive display and withdrawal/refund behavior will follow launch-market law.
- The beta sample and quality thresholds in Section 8 are practical initial gates and may be raised, but not silently lowered, by accountable owners before release.
- Exact AI allowance, supported browser/OS matrix, launch countries, and sensitive-content retention periods must be approved before production launch.
