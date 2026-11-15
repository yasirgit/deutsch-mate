# Runbook template — Incident response (incident command)

> **Template status:** skeleton for DM-004. Instantiate as `docs/runbooks/incident-response.md`
> when DM-062 completes it with environment-specific values. Replace every
> `TODO(owner)` before the runbook is considered operational (MVP Gate G8 requires
> named owners and a completed tabletop exercise).

## Purpose

Coordinate detection, containment, recovery, and evidence for any production incident
(availability, security, privacy, billing integrity, AI safety, data integrity), and
govern emergency changes per `docs/CODING_STANDARDS.md` §18: urgency never waives
audit, safety, or rollback requirements.

## Owner role

- **Incident commander:** TODO(owner) — on-call rotation name and escalation path.
- **Deputy/communications:** TODO(owner).
- Security, privacy, billing, AI-quality, and data owners join per incident class.

## Preconditions

- Access to dashboards, alert console, and audit trail: TODO(owner) — links.
- Paging tool and incident channel conventions: TODO(owner).
- This runbook's tabletop exercise is complete and recorded.

## Detection and alerts

- Actionable alerts per ADR-018: availability, latency (core API p95 > 300 ms),
  queue age (critical queue > 5 min for 10 continuous min), AI failures/cost,
  webhook failures, entitlement mismatches, privacy request age.
- Alert routing and severity matrix: TODO(owner).

## Procedure

1. **Acknowledge and classify.** Assign severity and incident class (availability /
   security / privacy / billing / AI safety / data). Severity definitions: TODO(owner).
2. **Open an incident record** with timestamp, correlation/trace IDs, and suspected
   scope. Never copy raw learner content, tokens, provider payloads, or signed URLs
   into tickets or chat — reference IDs only.
3. **Decision point — is a specialized runbook applicable?**
   - AI output/release problem → `ai-rollback.md`.
   - Bad curriculum release → `content-rollback.md`.
   - Entitlement/subscription mismatch → `billing-reconciliation.md`.
   - Data loss/corruption → `database-restore.md`.
   - Otherwise continue here.
4. **Contain.** Prefer reversible controls first: feature kill switch, canary halt,
   admission control, credential rotation (only if exposure is plausible).
5. **Decision point — is an emergency change required?** If yes, it still ships
   through CI with required checks; it receives an immediate follow-up review and
   an append-only audit event. Self-approval of governed areas is not permitted.
6. **Recover** using the applicable specialized runbook or a reviewed fix.
7. **Stand down** when verification passes; record the timeline.

## Verification

- Triggering alerts have cleared and stayed clear for TODO(owner) minutes.
- Affected user journeys pass smoke checks: TODO(owner) — command/links.
- No fabricated learning evidence, entitlement drift, or prohibited-data telemetry
  was introduced during response.

## Rollback / escape

- If containment or a fix worsens impact, revert to the last known-good deployment
  or release pin and re-enter this procedure at step 4.
- Escalation path when incident commander is unavailable: TODO(owner).

## Communication

- Internal: incident channel + status cadence TODO(owner).
- External/user-facing status page policy: TODO(owner).
- Privacy incidents: assess regulator/data-subject notification duty with the
  privacy owner before any external statement. Deadlines: TODO(owner).

## Post-incident evidence to retain

- Incident record: timeline, severity, class, owners, decisions, correlation IDs.
- Audit events for privileged/emergency actions.
- Follow-up review of any emergency change, and the regression test added.
- Blameless postmortem with tracked action items: TODO(owner) — storage location.
