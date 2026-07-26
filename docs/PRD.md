# Deutsch Mate Product Requirements Document

**Status:** Product and implementation baseline  
**Product:** Deutsch Mate  
**Audience:** Product, design, engineering, data, content, support, and assessment teams  
**Target users:** Adult self-learners of German at CEFR A1-B2  
**Business model:** B2C subscription  
**Technical authority:** `docs/architecture.md`

## 1. Purpose

Deutsch Mate is a guided German-learning product for adults who want practical progress from beginner (A1) through upper-intermediate (B2). It combines a structured CEFR-aligned curriculum, deterministic practice, and a context-aware AI tutor across web, iOS, and Android.

This document defines the product outcomes and testable requirements. It does not replace the architecture: where implementation details differ or are omitted here, `docs/architecture.md` is authoritative.

## 2. Product vision and principles

### Vision

Help an adult learner consistently know what to study next, practice all core language skills, receive useful feedback, and see credible evidence of progress toward CEFR A1-B2 goals.

### Product principles

1. **Guided before open-ended.** Every learner has a clear next lesson; AI augments the curriculum rather than replacing it.
2. **Practice for real life.** Content centers on adult goals such as relocation, work, study, travel, and daily life.
3. **Explain, do not merely judge.** Feedback identifies the error, explains it at the learner's level, and offers a next action.
4. **Evidence over engagement theater.** Progress reflects demonstrated skill, not only time or streaks.
5. **Honest CEFR positioning.** Product results are estimates and learning evidence, not accredited certificates.
6. **Safe, private, and resilient.** Minimize personal data and retain a deterministic learning path when AI is unavailable.
7. **Accessible across devices.** Core learning flows work on responsive web and React Native mobile clients.

## 3. Goals and non-goals

### Goals

- Enable a new learner to choose or estimate a starting level and begin an appropriate lesson in one session.
- Provide a coherent curriculum spanning A1, A2, B1, and B2.
- Improve reading, listening, writing, speaking, vocabulary, and grammar through guided practice.
- Use learner evidence to recommend review and the next curriculum unit.
- Convert qualified free users to a paid B2C subscription and maintain understandable entitlements.
- Establish measurable quality controls for AI feedback and CEFR alignment.

### Non-goals

- Accredited language certification or claims of equivalence to Goethe, telc, TestDaF, or another examination body.
- Instructor-led classes, school administration, enterprise tenancy, or teacher marketplaces.
- CEFR C1-C2 learning paths at initial product scope.
- Social feeds, learner-to-learner messaging, or competitive multiplayer features.
- Full offline learning or offline AI inference.
- Support for children as a target segment.

## 4. Personas

### P1 — Relocating beginner

- Adult with little or no German, typically A1.
- Needs survival language for housing, transport, healthcare, shopping, and public services.
- Has 10-20 minutes on most days and needs plain-language explanations.
- Success means completing useful interactions with less dependence on translation.

### P2 — Career-focused improver

- Adult at A2-B1 who needs German for work or career mobility.
- Has uneven grammar, vocabulary, and speaking confidence.
- Wants targeted correction, progress evidence, and efficient study.
- Success means functioning independently in routine workplace and social situations.

### P3 — Independent B2 aspirant

- Adult at B1 who is working toward B2 for study, employment, or personal goals.
- Needs more demanding reading, listening, argumentation, writing, and speaking practice.
- Expects precise feedback and credible readiness indicators.
- Success means consistently demonstrating B2 can-do outcomes, without mistaking the product for certification.

### P4 — Returning learner

- Adult whose prior German is incomplete or rusty.
- Does not know their current level and dislikes restarting from the beginning.
- Needs quick placement, focused review, and visible recovery of prior knowledge.
- Success means entering at a defensible point and closing specific gaps.

## 5. Jobs to be done

- **JTBD-01:** When I start or resume German, help me identify the right next activity so I do not waste study time.
- **JTBD-02:** When I learn a concept, let me practice it in varied contexts until I can retrieve and apply it.
- **JTBD-03:** When I make a mistake, explain what went wrong and how to improve at a level I understand.
- **JTBD-04:** When I need conversational practice, give me a safe, relevant partner without requiring another person.
- **JTBD-05:** When my motivation drops, make progress and the smallest useful next step visible.
- **JTBD-06:** When I work toward A1-B2 outcomes, show evidence by skill and clearly state the limits of that estimate.
- **JTBD-07:** When I pay, make the price, renewal, access, cancellation, and restoration of access predictable.
- **JTBD-08:** When I share personal writing or speech, let me understand and control how that data is used.

## 6. Core journeys

### J1 — First session

1. Visitor reviews the product and plan terms.
2. User creates an account, confirms required legal agreements, and chooses a goal and study preference.
3. User self-selects a starting level from A1, A2, B1, or B2; placement is post-MVP.
4. Product recommends a starting unit for the selected level.
5. User completes a first lesson and sees feedback plus a next step.

**Success:** At least 70% of users who start onboarding begin a learning activity; median time from verified account to first activity is under 5 minutes when placement is skipped.

### J2 — Daily learning loop

1. Learner opens the home screen.
2. Product offers one primary next lesson and due review.
3. Learner completes a short sequence of instruction and practice.
4. Answers are scored; AI-supported feedback is clearly presented where used.
5. Learner sees skill evidence, earned progress, and the next recommended action.

**Success:** A learner can complete the loop in 10-20 minutes and resume safely after interruption.

### J3 — AI tutor and correction

1. Learner starts from a curriculum unit or selects a bounded practice mode.
2. Tutor receives the learner's level, current unit, recent relevant mistakes, and entitlements.
3. Learner chats by text or submits writing; speech modes are post-MVP.
4. Tutor responds at the target level with corrections and a concrete retry.
5. Verified learning evidence is saved; uncertain or failed AI output is not treated as mastery.

**Success:** Responses are relevant, level-appropriate, safe, and traceable to prompt/model versions.

### J4 — Review and progress

1. Product identifies due vocabulary, grammar, and skill review from prior attempts.
2. Learner completes mixed retrieval and application tasks.
3. Product updates the learner model from append-only evidence.
4. Progress view shows current estimate, evidence by skill, uncertainty, and recommended gaps.

**Success:** The learner can distinguish curriculum completion from estimated proficiency.

### J5 — Subscription

1. User reaches a premium limit or opens plan settings.
2. Product presents price, billing period, trial or introductory terms, renewal, cancellation, and feature access.
3. Web purchase completes through Stripe-hosted Checkout; mobile purchase uses store-compliant adapters when offered.
4. Signed provider events update an internal entitlement.
5. User can view status, manage renewal, cancel, and regain access after reconciliation or restoration.

**Success:** Payment provider state and product entitlement converge without exposing card data.

## 7. Functional requirements

Priorities are **P0** (required for the first public paid release), **P1** (next product increment), and **P2** (later). `docs/MVP_SCOPE.md` is the release authority for MVP inclusion.

### Identity, consent, and profile

#### FR-001 — Account lifecycle (P0)
Users shall be able to register, sign in, sign out, recover access, and delete their account through OIDC-backed identity flows.

**Acceptance criteria**
- Email or configured federated identity can create one learner account.
- Authentication credentials and short-lived tokens are handled by the approved identity provider and secure client storage.
- Account deletion requires re-authentication or an equivalent high-assurance confirmation and starts the documented deletion workflow.
- Signed-out and deleted users cannot access authenticated learning resources.

#### FR-002 — Consent and legal versions (P0)
The product shall record acceptance of the current terms and privacy notice and separately record optional product communications consent.

**Acceptance criteria**
- Required and optional consents are unbundled.
- Each record includes user, document or purpose, version, decision, and timestamp.
- Users can withdraw optional consent without losing core paid functionality.

#### FR-003 — Learner profile and goals (P0)
Users shall be able to set and update learning goal, current or target level, study cadence, interface locale, and relevant preferences.

**Acceptance criteria**
- Supported target levels are A1, A2, B1, and B2.
- Profile changes affect future recommendations without rewriting historical attempts.
- The service maintains a versioned proficiency vector distinct from identity data.

### Onboarding and placement

#### FR-010 — Guided onboarding (P0)
The product shall guide a new user through goal selection, level choice, study preference, and a first recommended activity.

**Acceptance criteria**
- Users can skip nonessential questions.
- Users who know their level can begin without taking placement.
- Interrupted onboarding resumes from the last durable step.

#### FR-011 — Placement estimate (P1)
The product shall offer a blueprint-led placement assessment using human-approved item pools and versioned scoring.

**Acceptance criteria**
- Assessment coverage, timing, skill weights, and thresholds come from an approved versioned blueprint.
- Closed responses are scored deterministically.
- Results identify an estimated entry level and skill gaps, include uncertainty language, and do not claim certification.
- Submitted attempts are durable, idempotent, and auditable.

#### FR-012 — Starting-point override (P1)
Learners shall be able to choose a different starting unit from the recommendation.

**Acceptance criteria**
- The product explains likely difficulty when the override materially differs from evidence.
- The override does not alter historical placement evidence.

### Curriculum and lessons

#### FR-020 — Versioned CEFR curriculum (P0)
The product shall provide a structured, versioned curriculum for A1-B2 mapped to CEFR can-do statements and language skills.

**Acceptance criteria**
- Every published unit has a level, objectives, prerequisite relationships, skills, and can-do mappings.
- Published curriculum versions are immutable; updates create a new version.
- All P0 lesson content needed for a released unit remains usable during an AI-provider outage.

#### FR-021 — Lesson delivery (P0)
The product shall deliver short guided lessons containing explanation, examples, and practice.

**Acceptance criteria**
- A lesson supports deterministic exercise types including selection, matching, ordering, cloze, and typed response where an exact or allowlisted answer is appropriate.
- Progress is saved after each scored activity and resumes across supported devices.
- Completion requires defined required activities, not elapsed time alone.

#### FR-022 — Listening practice (P0)
The product shall provide level-appropriate listening activities with replay and transcripts subject to activity rules.

**Acceptance criteria**
- Audio has accessible controls and associated text metadata.
- Scored listening items use versioned answer keys.
- Transcript visibility is configurable before or after submission by the activity design.

#### FR-023 — Vocabulary and grammar practice (P0)
The product shall provide contextual vocabulary and grammar practice linked to curriculum objectives.

**Acceptance criteria**
- Activities identify the targeted objective and level.
- Feedback includes the correct response and an explanation or approved rationale.
- Attempts contribute to review scheduling and skill evidence.

#### FR-024 — Writing practice and correction (P0)
The product shall accept short learner writing and provide level-appropriate correction and a retry opportunity.

**Acceptance criteria**
- Feedback distinguishes task completion, grammar, vocabulary, and clarity as applicable.
- The original text, corrected text, feedback, prompt/model provenance, and user disposition are traceable under retention policy.
- If AI correction fails verification or times out, the learner is told that feedback is unavailable and the submission is not counted as demonstrated mastery.

#### FR-025 — Speaking and pronunciation practice (P1)
The product shall accept learner audio for transcription and guided speaking feedback.

**Acceptance criteria**
- Upload uses signed, expiring media access and asynchronous processing.
- Feedback distinguishes transcript-based language dimensions from acoustic pronunciation evidence.
- Users can replay or delete eligible recordings according to retention policy.
- A processing failure does not lose the learning session or fabricate a score.

#### FR-026 — Limited offline practice (P2)
Mobile clients shall support cached deterministic exercises and lesson metadata for limited offline use.

**Acceptance criteria**
- Offline scope and staleness are visible.
- Attempts synchronize idempotently when connectivity returns.
- AI, billing, and consequential assessment are not represented as available offline.

### Review, adaptation, and progress

#### FR-030 — Due review (P0)
The product shall schedule review from learner attempts and present a bounded queue of due items.

**Acceptance criteria**
- Scheduling uses persisted learning evidence and a versioned algorithm.
- The queue mixes retrieval and contextual application where content permits.
- A failed AI dependency does not prevent deterministic review.

#### FR-031 — Next-activity recommendation (P0)
The product shall recommend a primary next activity from prerequisites, recent evidence, due review, goal, and entitlement.

**Acceptance criteria**
- The recommendation is reproducible from a recorded algorithm version and relevant durable state.
- Locked recommendations provide an available alternative or a clear subscription action.
- Users can choose another available activity.

#### FR-032 — Progress dashboard (P0)
The product shall show curriculum completion, recent activity, review status, and estimated proficiency evidence by skill.

**Acceptance criteria**
- Completion and proficiency are labeled separately.
- Estimates show the evidence date and do not imply accredited certification.
- No proficiency estimate is based only on engagement time or AI conversation volume.

#### FR-033 — Study reminders and streaks (P1)
Users shall be able to opt into study reminders and view a non-punitive consistency indicator.

**Acceptance criteria**
- Reminder channel, cadence, timezone, and opt-out are user-controlled.
- Missing a day does not remove earned learning evidence.

### AI tutor

#### FR-040 — Contextual tutor chat (P0)
Entitled users shall be able to use a streamed AI tutor grounded in their target level and current curriculum context.

**Acceptance criteria**
- The tutor can explain, provide examples, ask practice questions, and guide retries within an allowlisted feature set.
- Context includes only necessary profile and learning data.
- Responses pass schema, safety, and CEFR suitability checks before or during learner-safe publication.
- The UI identifies AI-generated feedback and handles interruption, timeout, and retry without duplicate durable actions.

#### FR-041 — Tutor boundaries and safety (P0)
The tutor shall enforce bounded tools, reject unsafe or irrelevant requests appropriately, and avoid presenting unsupported claims as fact.

**Acceptance criteria**
- Clients cannot invoke models directly or select arbitrary tools.
- Prompt injection in learner or content text cannot grant access to secrets, other users' data, or unapproved egress.
- Safety dispositions and verifier outcomes are traceable.

#### FR-042 — AI feedback reporting (P1)
Users shall be able to report incorrect, unsafe, or unhelpful AI feedback.

**Acceptance criteria**
- A report references the relevant trace without requiring the user to resubmit sensitive content.
- Reports enter a reviewable queue and can be aggregated by prompt and model version.

#### FR-043 — Conversation history controls (P1)
Users shall be able to view and delete eligible tutor conversations.

**Acceptance criteria**
- Deletion behavior and exceptions for security, billing, or aggregated evidence are disclosed.
- Deleted content is removed according to the retention workflow and no longer supplied as tutor context.

### Assessment and CEFR evidence

#### FR-050 — Formative checks (P0)
Units shall include scored formative checks that measure stated objectives.

**Acceptance criteria**
- Each scored item maps to a curriculum objective and a versioned answer key or rubric.
- Learners receive answer feedback after submission according to item rules.
- Scores contribute to recommendations but are not represented as certification.

#### FR-051 — Level readiness assessment (P2)
The product shall support controlled A1-B2 level-readiness assessments assembled from approved blueprints.

**Acceptance criteria**
- Generated candidate items pass deterministic, independent-model, and qualified-human release gates before publication.
- Published forms and scoring rules are immutable and retain full provenance.
- Writing and speaking use analytic rubrics and disagreement escalation.
- Learners receive an appeal path for consequential results.

#### FR-052 — CEFR result language (P0)
All level labels and readiness results shall be positioned as product estimates aligned to CEFR descriptors.

**Acceptance criteria**
- Result screens and marketing do not call the outcome an accredited certificate.
- The product explains assessed skills, evidence limits, and date.
- Named exam-provider equivalence is not claimed without separate validation and authorization.

### Billing and entitlements

#### FR-060 — Plan presentation (P0)
The product shall present free and paid access with price, billing period, renewal, cancellation, taxes where known, and feature limits before purchase.

**Acceptance criteria**
- The final charged amount and recurring nature are visible before confirmation.
- Plan copy is consistent with effective entitlement configuration.
- Trial or promotional terms, if offered, include end date and post-promotion price.

#### FR-061 — Web subscription purchase (P0)
Web users shall be able to purchase the paid subscription through Stripe Checkout and Billing.

**Acceptance criteria**
- Card data is collected by Stripe-provided surfaces and is not stored by Deutsch Mate.
- Signed webhook events are persisted and processed idempotently.
- Successful provider state creates or updates provider-agnostic internal entitlements.
- Duplicate, delayed, or reordered events do not grant duplicate or contradictory access.

#### FR-062 — Subscription management (P0)
Subscribers shall be able to view subscription status, next billing date, plan, and a provider-supported path to cancel or manage billing.

**Acceptance criteria**
- Cancellation timing and remaining access are shown clearly.
- Product access is derived from internal entitlements, not a synchronous Stripe call.
- Scheduled reconciliation detects and repairs mismatches.

#### FR-063 — Free access and premium limits (P0)
The product shall offer useful free learning while enforcing configurable premium limits.

**Acceptance criteria**
- Free users can complete onboarding, access a defined curriculum sample, and use deterministic practice.
- Premium limits are enforced server-side by entitlement and are understandable in the client.
- Exhausting a premium allowance never blocks account, privacy, or billing controls.

#### FR-064 — Mobile purchases (P1)
When paid conversion is offered inside iOS or Android apps, the product shall use store-compliant native purchase adapters and normalize access into internal entitlements.

**Acceptance criteria**
- Apple and Google policy review is completed before mobile purchase release.
- Purchase restoration and provider reconciliation are supported.
- Stripe is not assumed to satisfy mobile store billing rules.

### Data rights, support, and operations

#### FR-070 — Privacy controls (P0)
Users shall be able to access the privacy notice, manage optional consent, request a data export, and request account deletion.

**Acceptance criteria**
- Requests have a durable status and are fulfilled within the applicable legal period.
- Export includes user-provided data and key learning records in a usable format.
- Deletion honors disclosed legal and security retention exceptions and removes data from active systems and backups according to policy.

#### FR-071 — Support contact (P0)
Users shall have an accessible way to request account, learning, privacy, and billing support.

**Acceptance criteria**
- The request captures category and contact path without exposing secrets.
- Privacy and billing categories route to the appropriate operational queue.

#### FR-072 — Content and AI release governance (P0)
Authorized staff shall be able to version, review, approve, publish, and roll back curriculum, prompts, rubrics, and model configurations.

**Acceptance criteria**
- Learner clients cannot access drafts.
- Publication records actor, version, validation result, and timestamp.
- A previously approved version can be restored without rewriting historical provenance.

#### FR-073 — Assessment review console (P2)
Qualified reviewers shall be able to review generated assessment candidates, validation evidence, and flagged results.

**Acceptance criteria**
- Role-based access separates reviewer and administrator actions.
- Approval and rejection are immutable audit events.
- No generated candidate becomes a published consequential form without required gates.

## 8. Pricing and packaging assumptions

These assumptions enable implementation and financial modeling; exact prices require market testing and tax review.

### Free

- No payment method required.
- Access to onboarding, all four level previews, the first unit of the selected level, deterministic practice for unlocked content, and limited AI tutor usage.
- Progress and privacy controls remain available.

### Premium

- One individual subscription tier at launch to minimize packaging complexity.
- Working assumption: **EUR 14.99 monthly** or **EUR 119.99 annually**, inclusive or exclusive of tax as required by buyer location and storefront presentation.
- Annual plan is the default value comparison, not a forced preselection.
- Premium unlocks the released curriculum, higher AI tutor allowance, writing feedback, cross-device progress, and other entitlement-configured features.
- No lifetime plan at launch.
- A trial is optional and should not launch unless conversion, reminder, cancellation, and consumer-law behavior are fully implemented.

### Commercial rules

- Web uses Stripe Checkout and Billing.
- Mobile purchase availability and pricing may differ because of store rules and regional price tiers.
- Prices, allowances, and feature mappings are configuration, not client constants.
- Cancellation stops future renewal while preserving access through the paid period unless law or refund policy requires otherwise.
- Refund handling follows the payment provider, storefront, and applicable consumer law.

## 9. Metrics and instrumentation

All metrics shall be segmented where privacy-safe by platform, acquisition source, selected level, country or region, and plan. Learning-outcome metrics must not be optimized solely for engagement.

### North-star metric

**Weekly Successful Learning Sessions (WSLS):** count of unique learner sessions in which the learner completes at least one objective-linked activity and produces valid scored evidence or completes a verified guided practice interaction.

### Product funnel

- Visitor-to-registration conversion.
- Onboarding completion rate.
- First learning activity start and completion rate.
- Median time from verified account to first activity.
- Placement start and completion rate when offered.
- Free-to-paid conversion by cohort.
- Checkout completion and entitlement activation rate.
- Monthly and annual subscriber churn.

### Engagement and retention

- D1, D7, D30 learner retention.
- Weekly active learners and WSLS per active learner.
- Lesson completion, interruption, and resume rates.
- Due-review completion rate.
- Tutor sessions with a learner retry or follow-up practice action.

### Learning and quality

- Objective-level first-attempt and delayed-retrieval performance.
- Skill evidence coverage and time to close a detected gap.
- Human-rated linguistic correctness and CEFR suitability for AI outputs.
- AI feedback report rate and confirmed material-error rate.
- Formative assessment reliability and item statistics where sample size permits.
- Placement/readiness false-pass and false-fail estimates only after a validated labeled dataset exists.

### Reliability, cost, and safety

- Product API availability and p95 latency.
- Tutor first verified learner-visible delta p95 latency and completed-response rate.
- AI cost per successful learning session and per subscriber.
- Queue age, job failure, retry, and dead-letter rates.
- Safety block, false-positive, and verified incident rates.
- Subscription/provider mismatch rate and reconciliation age.
- Privacy request completion time and overdue count.

### Event requirements

- Events use a versioned taxonomy and stable anonymous or pseudonymous identifiers.
- Learning events include curriculum, content, algorithm, rubric, and relevant prompt/model versions.
- Product analytics excludes raw writing, chat, and audio content by default.
- Consent and retention policy determine downstream eligibility.

## 10. Non-functional requirements

#### NFR-001 — Availability
The production Product API shall achieve 99.9% monthly availability, excluding published maintenance windows.

**Acceptance criteria:** Monitoring measures externally observable success; alerting and incident review cover objective breaches.

#### NFR-002 — Performance
Core non-AI API requests shall have p95 server latency below 300 ms, and tutor first verified learner-visible delta latency shall be below 2 seconds at p95 under the documented launch load.

**Acceptance criteria:** Load tests use representative authenticated routes and report percentile, error, and saturation data separately for core and AI paths.

#### NFR-003 — Durability and recovery
Transactional state shall use PostgreSQL as the source of truth with a recovery point objective of at most 5 minutes.

**Acceptance criteria:** Multi-AZ failover, point-in-time recovery, cross-account backup, and restoration runbooks are tested before release; Redis loss cannot erase attempts, subscriptions, or results.

#### NFR-004 — Graceful degradation
Deterministic lessons and practice shall remain usable when OpenAI or AI workers are unavailable. The same rule applies to speech processing if a speech capability is released post-MVP.

**Acceptance criteria:** Dependency failure tests show a clear feature-level status, bounded retry behavior, no fabricated output, and no corruption of durable learning state.

#### NFR-005 — Security
The platform shall use least privilege, TLS in transit, encryption at rest, secure secret storage, short-lived identity tokens, signed media access, abuse controls, and auditable privileged actions.

**Acceptance criteria:** Threat modeling covers identity, AI prompt injection, uploads, billing webhooks, and cross-user authorization; no unresolved critical or high-severity release-blocking finding remains.

#### NFR-006 — Privacy and GDPR
The product shall implement purpose limitation, data minimization, consent history, user access/export/deletion workflows, retention schedules, and an international subprocessor transfer inventory.

**Acceptance criteria:** A data inventory identifies purpose, lawful basis, location, retention, and subprocessor for each personal-data class; privacy requests are testable end to end.

#### NFR-007 — AI governance and traceability
Every learner-facing AI result shall be attributable to feature, prompt version, model version, relevant sources and tools, latency, cost, verifier result, and disposition.

**Acceptance criteria:** Trace lookup supports quality investigation while raw sensitive content follows a shorter, explicit retention period.

#### NFR-008 — AI quality
Prompt or model changes shall pass offline regression against qualified-teacher golden data and a controlled production shadow or canary evaluation before full release.

**Acceptance criteria:** Release criteria cover linguistic correctness, CEFR fit, rubric error, safety, latency, and cost, with automatic or operator rollback.

#### NFR-009 — Accessibility
Core web and mobile learning, account, and billing journeys shall conform to WCAG 2.2 AA where applicable.

**Acceptance criteria:** Keyboard or switch navigation, screen-reader labels, focus order, contrast, text scaling, captions/transcripts, and non-color status cues are tested on the supported matrix.

#### NFR-010 — Client compatibility
The product shall support the documented current browser and mobile OS matrix with generated clients based on the versioned OpenAPI contract.

**Acceptance criteria:** Contract tests run against Next.js web and React Native clients; unsupported versions are disclosed.

#### NFR-011 — Observability
Requests and asynchronous jobs shall propagate correlation IDs and emit structured logs, traces, and RED or queue metrics without logging secrets or unrestricted learner content.

**Acceptance criteria:** Operators can trace a failed learning, AI, media, or entitlement operation across API and worker boundaries.

#### NFR-012 — Idempotency and consistency
Learning attempts, purchases, webhook handling, asynchronous consumers, and exam submissions when a released assessment capability exists shall be idempotent.

**Acceptance criteria:** Duplicate and reordered request/event tests produce one effective business outcome and preserve an auditable ledger.

#### NFR-013 — Scalability
Product API, AI workers, and release workers shall scale independently on the architecture-defined signals without changing consistency boundaries.

**Acceptance criteria:** Launch-load and 2x forecast tests document safe capacity, queue age, database connections, cost, and autoscaling behavior.

#### NFR-014 — Content and assessment integrity
Published curriculum, prompts, rubrics, scoring rules, and any released assessment forms shall be immutable and versioned.

**Acceptance criteria:** Historical attempts resolve to the exact released versions; administrative release actions are audited.

#### NFR-015 — Maintainability
The implementation shall use TypeScript end to end: Next.js web, React Native mobile, NestJS modular Product API and workers, and LangGraph.js workflows.

**Acceptance criteria:** Shared contracts are generated from OpenAPI or typed schemas; CI enforces formatting, linting, type checks, tests, migrations, and dependency/security checks.

#### NFR-016 — Regional architecture
Production shall launch in an EU primary AWS region with environment isolation and infrastructure as code.

**Acceptance criteria:** Development, staging, and production are isolated; production data paths and approved international transfers are documented.

## 11. Privacy and data policy requirements

### Data classes

- **Account:** identity-provider reference, contact details, locale, consent history.
- **Learning evidence:** unit versions, attempts, answers, scores, latency, feedback, proficiency vectors.
- **Sensitive learner content:** tutor messages, free-form writing, audio, transcripts, and pronunciation evidence.
- **Billing:** customer and subscription references, invoices and entitlement state; no stored card data.
- **Operational metadata:** audit logs, AI provenance, security events, and correlation identifiers.

### Policy baseline

- Collect only data required for the active feature and disclosed product operations.
- Remove unnecessary personal data before AI calls and use the strongest available provider data-control and retention terms.
- Use pseudonymized data for analytics and assessment analysis.
- Define and publish retention periods before collecting raw chat, writing, audio, or transcript content.
- Do not use learner content for model training without a separate, specific, optional consent and vendor controls that support the promise.
- Age-gate the product as adult-directed; users who do not meet the applicable minimum age cannot self-enroll.
- Do not use sensitive learning evidence for behavioral advertising.
- Maintain export, deletion, legal-hold, incident response, and subprocessor-change procedures.

## 12. CEFR positioning and content quality

- The curriculum covers A1-B2 and maps units to selected CEFR Companion Volume can-do descriptors.
- CEFR alignment describes the content framework and product estimates; it is not accreditation.
- Marketing and in-product copy shall use phrases such as “CEFR-aligned,” “estimated level,” and “readiness evidence.”
- The product shall not use “certified,” “official CEFR certificate,” or named-exam equivalence unless a separate validation and accreditation program authorizes the claim.
- Qualified German-language experts approve curriculum frameworks, representative content, assessment blueprints, and golden evaluation data.
- AI-generated learning content must pass deterministic and model verification; consequential assessment content additionally requires qualified human and psychometric governance as defined by the architecture.
- Level estimates must be based on versioned tasks and scoring rules with evidence across relevant skills; insufficient evidence must be shown as such.

## 13. Dependencies and risks

| Risk or dependency | Impact | Product response |
|---|---|---|
| AI correction is wrong or level-inappropriate | Learner harm and lost trust | Bounded workflows, verifier, uncertainty behavior, teacher-labeled evaluations, feedback reporting, rollback |
| CEFR claims exceed evidence | Regulatory and reputational risk | Explicit estimate language, human governance, no certification claim, validation before consequential use |
| Curriculum breadth reduces content quality | Weak learning outcomes | Release coherent level slices, objective-level QA, immutable versions, defer breadth when gates fail |
| Speech feedback confuses transcription and pronunciation | Misleading guidance | Separate evidence dimensions, asynchronous failure states, human evaluation |
| Provider outage or latency | Broken learning loop | Deterministic fallback, circuit breakers, cached approved content, clear status |
| AI usage cost exceeds subscription economics | Unsustainable unit economics | Entitlement allowances, budgets, tiered routing, caching where safe, per-session cost metrics |
| Web and mobile billing policies diverge | Rejection or inconsistent access | Provider-agnostic entitlements, native adapters, store policy review, reconciliation |
| Subscription event disorder | Incorrect access | Signed webhook ledger, idempotency, transactional entitlement update, scheduled reconciliation |
| Sensitive writing or audio is over-retained | Privacy and trust harm | Data minimization, explicit retention, signed access, deletion workflow, redacted traces |
| Placement or readiness is biased | Wrong recommendations | Approved blueprints, representative golden data, item statistics, fairness review before scale |
| Adult users have inconsistent time and motivation | Low retention | Short resumable sessions, one clear next action, review queue, user-controlled reminders |
| Architecture scope creates delivery risk | Delayed release | Modular monolith, asynchronous workers only where justified, measurable MVP gates |

## 14. Product-wide acceptance and release policy

A feature is releasable only when:

1. Its requirement ID is mapped to an approved scope and owner.
2. User-visible states cover loading, empty, success, validation, authorization, dependency failure, retry, and recovery where applicable.
3. Analytics measure the intended outcome without collecting unrestricted learner content.
4. Accessibility and supported-client checks pass.
5. Security, privacy, retention, and entitlement behavior are documented and tested.
6. AI features have versioned prompts/models, traceability, evaluation thresholds, and graceful failure behavior.
7. Learning and assessment content has the required CEFR mapping and human approval.
8. API contracts, migrations, runbooks, alerts, and rollback paths are ready.
9. `docs/MVP_SCOPE.md` release gates are met for the first public paid release.

## 15. Assumptions and open validation items

### Fixed assumptions

- Target users are adult self-learners.
- Supported proficiency range is CEFR A1-B2.
- The commercial model is an individual B2C subscription.
- Implementation is TypeScript end to end with Next.js, React Native, NestJS, and LangGraph.js, within the architecture-defined AWS design.
- Initial production is EU-first and English may be the initial interface/explanation language.

### Items to validate without blocking initial implementation

- Final monthly and annual price by launch market and tax treatment.
- Free AI allowance and premium fair-use limits that meet unit-economics targets.
- Which mobile storefronts permit launch of consumption-only apps before native purchase is complete.
- Initial supported interface locales and acquisition countries.
- Exact raw tutor, writing, audio, transcript, and AI-trace retention periods.
- Teacher-labeled quality thresholds and representative first-language cohorts for AI evaluation.
