# Release evidence record — <release identifier>

> **Template.** Copy to `docs/release/<YYYY-MM-DD>-<release-id>.md` for each release
> candidate and fill every field. All MVP gates in `docs/MVP_SCOPE.md` §8 must pass
> in staging or production-like conditions, and evidence is retained in this record
> (MVP_SCOPE §8; CODING_STANDARDS §17 release requirement). Sign-offs come from the
> accountable owner roles; authors cannot self-approve governed releases
> (CODING_STANDARDS §18).

## Release metadata

| Field | Value |
|---|---|
| Release ID / tag | |
| Date | |
| Release owner | |
| Git commit SHA(s) | |
| Environments promoted | dev → staging → production |
| `pnpm ci` run (link) | |
| `pnpm release:verify` run (link) | |
| OpenAPI version / compatibility notes | |
| Database migrations included (IDs) | |
| Content release IDs included | |
| AI release IDs included (with evaluation records) | |
| Infrastructure changes (IaC plan links) | |
| Waivers in effect (links to `docs/waivers/`, all unexpired) | |

## Deployment metadata

| Field | Value |
|---|---|
| Deployment mechanism (workflow run link) | |
| Deploy identity (short-lived role) | |
| Promotion approver (reviewed promotion) | |
| Canary / rollout steps executed | |
| Feature flags / kill-switch state at release | |

## Rollback target

| Field | Value |
|---|---|
| Application rollback target (image/tag/commit) | |
| Database compatibility (one-release backward compatible? expand/contract phase) | |
| AI rollback release IDs (`rollback_release_id` per feature) | |
| Content rollback release IDs | |
| Rollback tested (how, when, link) | |

## Gate evidence (MVP_SCOPE §8)

For each gate: what was run, where the results live (CI run, dashboard export,
document — durable links only), who signed off, and the date. A gate without all
four fields is not passed.

### G1 — Scope and content completeness

| Field | Value |
|---|---|
| What was run (content audit, approval-records check, copy review) | |
| Results location | |
| Signed off by (content owner + qualified German-language expert) | |
| Date | |

### G2 — Critical journey completion

| Field | Value |
|---|---|
| What was run (E2E suites web/iOS/Android, moderated beta results, defect triage) | |
| Results location | |
| Signed off by (product/QA owner) | |
| Date | |

### G3 — AI linguistic quality and safety

| Field | Value |
|---|---|
| What was run (frozen golden-set evaluation per released prompt/model config) | |
| Results location (evaluation record IDs, thresholds vs. actuals) | |
| Signed off by (language-quality owner AND safety owner) | |
| Date | |

### G4 — Reliability and recovery

| Field | Value |
|---|---|
| What was run (load at launch + 2x, AI-outage simulation, PITR restore drill, Redis-loss exercise) | |
| Results location (latency/error reports, achieved RPO/RTO) | |
| Signed off by (operations/data owner) | |
| Date | |

### G5 — Security and privacy

| Field | Value |
|---|---|
| What was run (threat-model approvals, scans, cross-user authorization suite, export/deletion E2E, telemetry capture) | |
| Results location | |
| Signed off by (security owner AND privacy owner) | |
| Date | |

### G6 — Billing and entitlement integrity

| Field | Value |
|---|---|
| What was run (webhook disorder suite, reconciliation test, card-data check, pricing surface audit, store-policy review) | |
| Results location | |
| Signed off by (billing owner) | |
| Date | |

### G7 — Accessibility and compatibility

| Field | Value |
|---|---|
| What was run (WCAG 2.2 AA review, assistive-tech matrix, contract tests web + both mobile builds, crash-free rate) | |
| Results location | |
| Signed off by (accessibility reviewer) | |
| Date | |

### G8 — Operations and launch control

| Field | Value |
|---|---|
| What was run (IaC reproducibility, dashboards/alerts review, runbook owners + tabletop records, CI gate summary) | |
| Results location | |
| Signed off by (operations owner) | |
| Date | |

### G9 — Commercial beta evidence

| Field | Value |
|---|---|
| What was run (beta cohort metrics, survey results, AI cost forecast vs. 20% revenue cap) | |
| Results location | |
| Signed off by (product owner) | |
| Date | |

## Outstanding findings

List every open finding with severity, owner, and disposition. Any unresolved
critical/high release-blocking finding stops the release (CODING_STANDARDS §20).

| Finding | Severity | Owner | Disposition (fixed / waived with link / blocking) |
|---|---|---|---|
| | | | |

## Final release decision

| Field | Value |
|---|---|
| Decision (go / no-go) | |
| Decided by | |
| Date | |
| Notes | |
