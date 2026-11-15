# Runbook template — AI release rollback

> **Template status:** skeleton for DM-004. Instantiate as `docs/runbooks/ai-rollback.md`
> when DM-062 completes it. Replace every `TODO(owner)` before operational use
> (MVP Gate G8). Source contracts: `docs/AI_AGENTS.md` §15 (kill switch), §18
> (rollout/rollback), §19.2 and §19.9 (failure runbooks); ADR-014, ADR-015.

## Purpose

Disable and/or roll back a released AI feature (tutor, writing correction, content
validation) to its approved immutable rollback target without losing provenance,
fabricating learning evidence, or disabling deterministic learning.

## Owner role

- **Primary:** TODO(owner) — AI-quality release owner.
- **Mandatory involvement for safety/privacy incidents:** safety, language-quality,
  and privacy owners (AI_AGENTS §19.2).

## Preconditions

- Every released prompt/model configuration has a recorded evaluation and an
  approved `rollback_release_id` (MVP Gate G3) — verify it exists before starting.
- Per-feature global kill switch is reachable and tested (AI_AGENTS §15).
- Access to AI release routing configuration and run/trace query tooling by
  release ID: TODO(owner) — links/commands.

## Detection and alerts

- Automatic promotion halt triggers (AI_AGENTS §18.7): unsafe release, cross-user
  access, gate breach, material correction-error regression, p95/availability SLO
  breach, budget threshold.
- Manual triggers: teacher/user reports of unsafe or materially wrong output.
- Alert names and dashboards: TODO(owner).

## Procedure

1. **Decision point — is the issue safety or privacy related?**
   - **Yes:** disable the feature/release kill switch immediately, cancel affected
     in-flight runs, and block unpublished output. Deterministic learning must
     remain available.
   - **No (quality/latency/cost):** halt canary promotion; pinned in-flight runs
     may complete (AI_AGENTS §18.8).
2. **Select the rollback target.** Roll routing back to the approved
   `rollback_release_id`. Rollback selects a previously approved immutable release
   and records `rollback_selected`; it never edits history or in-flight run pins.
3. **Purge unsafe ephemeral stream fragments**; preserve required audit and
   provenance records (AI_AGENTS §18.9).
4. **Identify affected run IDs by release ID** — query by release/tool/source IDs,
   never by raw content. Do not copy raw learner content into tickets.
5. **Decision point — did unsafe output reach learners or create evidence?**
   - If any mastery evidence derives from the bad release, involve the data owner;
     corrections append superseding facts, never rewrite attempts or scores.
6. **Notify incident owners** and open/link the incident record
   (`incident-response.md`).

## Verification

- Learner routes resolve the rollback release; new runs pin the rollback
  release ID. Verification command: TODO(owner).
- Kill switch state matches intent per feature; deterministic lessons/review/
  progress remain usable (simulate if needed).
- No new runs reference the rolled-back release after cutover.

## Rollback / escape

- If the rollback target itself misbehaves, roll back to the next older approved
  immutable release; if none is safe, keep the feature kill switch engaged —
  the product contract guarantees deterministic learning without AI.
- Application deployment rollback is independent of AI release rollback
  (AI_AGENTS §18); do not conflate them.

## Communication

- Notify: incident owners, safety/language/privacy owners as applicable,
  support (for user-facing degradation messaging). Channels: TODO(owner).

## Post-incident evidence to retain

- Rollback decision record: who, when, why, from-release, to-release,
  `rollback_selected` event ID.
- Affected run IDs and dispositions (IDs only, no raw content).
- Incident evaluation results, and the approved de-identified regression case
  added to the frozen dataset before re-release (AI_AGENTS §19.2).
- Re-release requires the full frozen evaluation and canary process again.
