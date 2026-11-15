# Runbook template — Curriculum content rollback

> **Template status:** skeleton for DM-004. Instantiate as
> `docs/runbooks/content-rollback.md` when DM-062 completes it. Replace every
> `TODO(owner)` before operational use (MVP Gate G8). Source contracts:
> `docs/AI_AGENTS.md` §17 and §19.9; `docs/Database.md` (immutability, release
> selection); ADR-015.

## Purpose

Replace a bad published curriculum release (wrong content, wrong answer key,
inappropriate material, broken assets) by selecting a previously approved
immutable release, without rewriting published history or learner evidence.

## Owner role

- **Primary:** TODO(owner) — content release owner.
- **Qualified German-language reviewer** for linguistic defects: TODO(owner).

## Preconditions

- A previously approved immutable release exists for the affected module/level.
- Access to protected content release operations (publish/rollback): TODO(owner).
- Rollback is a human-authorized operation; the content-validation graph can
  recommend but never approve, publish, or select rollback.

## Detection and alerts

- Learner or reviewer reports of wrong/unsafe content; support case volume on a
  specific unit/activity.
- Content-validation findings on a released version.
- Dashboards/alert names: TODO(owner).

## Procedure

1. **Identify the bad release** (release ID, affected level/module/units) and the
   candidate rollback target (previously approved immutable release).
2. **Decision point — is a canary in progress?** If yes, halt the canary first
   (AI_AGENTS §19.9).
3. **Decision point — is the content harmful or merely defective?**
   - **Harmful/unsafe:** proceed immediately; involve safety owner and open an
     incident (`incident-response.md`).
   - **Defective:** confirm with the qualified language reviewer that the rollback
     target is preferable to the current release.
4. **Select the rollback release** through the protected release operation. This
   records `rollback_selected` in append-only release history; publication re-runs
   deterministic validators transactionally.
5. **Invalidate only caches** so learner routes resolve the previous release —
   never edit published rows. Cache invalidation command: TODO(owner).
6. **Leave historical data pinned.** Historical runs, attempts, and scores remain
   pinned to their original content versions; corrections to evidence, if ever
   required, append superseding facts through the data owner.

## Verification

- Learner routes (web/mobile/API) resolve the rollback release for the affected
  scope. Verification command: TODO(owner).
- Scored items in the active release map to immutable content versions and answer
  keys/rubrics (Gate G1 invariant).
- Drafts remain invisible to learner routes.

## Rollback / escape

- If the rollback target is also defective, select the next older approved
  release. If no approved release is acceptable, unpublish the module scope per
  MVP_SCOPE (reduce optional content rather than ship a defective unit) —
  decision authority: TODO(owner).

## Communication

- Notify content, product, and support owners; user-facing messaging if learners
  saw materially wrong content: TODO(owner) — channels and templates.

## Post-incident evidence to retain

- Release history: bad release ID, rollback target ID, `rollback_selected` event,
  actor, timestamp, reason.
- Reviewer confirmation (qualified German-language expert) where linguistic.
- Root-cause note: how the defect passed review/validation, and the added
  validation or review-process fix.
