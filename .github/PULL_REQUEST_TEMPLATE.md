<!--
Governed by docs/CODING_STANDARDS.md §18 (pull requests) and §20 (Definition of Done).
Fill every top-level section. Write "None" or "N/A — <reason>" rather than deleting a
section, so reviewers can see the impact was considered. Collapsible sections apply
only when the change touches that area.
Authors cannot self-approve governed content or AI releases (§18).
-->

## Problem and outcome

<!-- What is broken/missing, and what does this change make true? 1-3 sentences each. -->

**Problem:**

**Outcome:**

## Requirements and decisions

<!-- Link the requirement IDs and ADRs this change implements or is constrained by. -->

- **Task:** DM-___
- **Requirements (FR/NFR):** <!-- e.g. FR-062; NFR-012 -->
- **ADRs:** <!-- e.g. ADR-016 -->
- **MVP gates affected (G1-G9):** <!-- e.g. G6, or None -->

## Scope and non-goals

**In scope:**

**Explicitly not in scope:**

## Design and boundary impact

<!-- New/changed module boundaries, cross-package edges, ports/adapters, events.
     New cross-package dependency edges require reviewer justification (§5). -->

- **Module/package boundaries affected:**
- **New dependency edges (with justification):** None

## Tests and evidence

<!-- What was tested, at which layer, and where results live. Changed behavior requires
     positive, negative, boundary, authorization, retry/idempotency, and failure-path
     coverage (§15). Bug fixes require a regression test at the lowest effective layer. -->

- **Commands run and results:**
- **Evidence location (CI run, artifact, docs/release record):**

## Security and privacy impact

<!-- Authorization, RLS, secrets, new data collection (purpose/basis/retention per §13),
     telemetry safety. Write "None" only if genuinely no impact. -->

## Accessibility and i18n impact

<!-- User-visible changes: WCAG 2.2 AA, keyboard/screen reader, externalized strings,
     text scaling (§14). "None" for non-UI changes. -->

## Compatibility

<details>
<summary>API / event / database compatibility (expand if this PR touches contracts, events, or schema)</summary>

- **OpenAPI:** spec, generated clients, server, and contract tests updated together; drift check passes. Breaking changes use a new version + deprecation plan (§9).
- **Events:** schema/version change and consumer compatibility described.
- **Migrations:** expand/contract phase stated; empty-build and previous-snapshot upgrade pass; lock/statement timeouts respected; one-release backward compatibility preserved (§10, Database.md §12).

</details>

## Observability

<!-- New/changed logs, metrics, traces, dashboards, alerts, SLO impact. Confirm no
     prohibited data (tokens, emails, raw learner content, provider payloads, signed URLs)
     enters telemetry (§13). -->

## Rollout plan

<!-- Deploy order, feature flag/kill switch, canary steps if applicable, config changes. -->

## Rollback plan

<!-- Concrete, tested path back: revert commit? disable flag? select prior immutable
     release? For migrations: expand/contract compatibility, never destructive reversal. -->

## Waivers

<!-- Any MUST exception requires a time-bounded, owner-named waiver approved by the
     relevant owner (§1) and a file in docs/waivers/. -->

None.

## Definition of Done checklist (CODING_STANDARDS §20)

<!-- Check what applies; strike through with a one-line reason what does not. -->

- [ ] Acceptance criteria and applicable requirement IDs satisfied; no excluded/post-MVP scope added
- [ ] Strict TypeScript, runtime validation, module boundaries, repository conventions followed
- [ ] API/event/database/client contracts and generated artifacts agree
- [ ] Migrations explicit, forward-safe, tested from empty and upgrade paths, with rollout/recovery plans
- [ ] Authorization, privacy, retention, security, accessibility, i18n, entitlement, idempotency, and failure states implemented and tested
- [ ] Unit/integration/contract/E2E/load-resilience/AI evaluation evidence complete in proportion to risk
- [ ] Logs, traces, metrics, dashboards, alerts, SLO impact, and runbooks make behavior operable without prohibited data
- [ ] Dependencies and infrastructure pass policy and security checks
- [ ] Documentation and ADRs current (contracts, runbooks, data inventory, threat models as applicable)
- [ ] CI and relevant MVP release gates pass; no unresolved critical/high release-blocking finding
- [ ] Rollout, compatibility, feature flag/kill switch where needed, and tested rollback defined
- [ ] No temporary bypass, TODO, disabled test, or waiver without owner, tracked issue, and expiry
