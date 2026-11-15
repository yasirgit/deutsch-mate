# Runbook template — Database restore (PITR / snapshot)

> **Template status:** skeleton for DM-004. Instantiate as
> `docs/runbooks/database-restore.md` when DM-062 completes it. Replace every
> `TODO(owner)` before operational use (MVP Gates G4, G8). Source contract:
> `docs/Database.md` §12 (migrations, backup, and restore); ADR-009, ADR-019.

## Purpose

Restore the production PostgreSQL cluster after data loss or corruption using
point-in-time recovery or snapshots, meeting **RPO ≤ 5 minutes** and the initial
**RTO target of 4 hours**, and re-open the product only after the mandatory
post-restore safety sequence.

## Owner role

- **Primary:** TODO(owner) — data owner / database operations.
- **Required during production restore:** incident commander, security owner
  (credential rotation), privacy owner (deletion suppression), billing owner
  (Stripe reconciliation).

## Preconditions

- Backup posture per Database.md §12: Multi-AZ RDS, continuous WAL archiving,
  PITR window 35 days, daily snapshots 35 days, monthly cross-account/cross-region
  copies 12 months, annual copies 7 years where billing/audit law requires.
- Least-privilege restore role and distinct backup KMS keys are provisioned and
  key-recovery is tested: TODO(owner) — role/key identifiers.
- Deletion-suppression tombstone ledger is reachable (Database.md §11).
- Quarterly restore drill for this runbook is current: TODO(owner) — last drill date.

## Detection and alerts

- Triggers: data corruption, failed migration with data damage, accidental
  destructive write, storage failure beyond Multi-AZ failover, region/account
  compromise.
- This runbook is for restore; plain instance failure is handled by Multi-AZ
  failover and does not require it.
- Alert names and dashboards: TODO(owner).

## Procedure

1. **Declare an incident** (`incident-response.md`) and freeze risky writes:
   stop workers and disable outbox publishing before restore decisions.
   Commands: TODO(owner).
2. **Choose the recovery point.** Latest point before corruption within the PITR
   window. Record the target timestamp and the expected data-loss window
   (must satisfy RPO ≤ 5 min for infrastructure failure; corruption cases record
   the actual loss window explicitly).
3. **Restore into an isolated account/VPC first** — never in place. Restore
   procedure/tooling: TODO(owner).
4. **Verify the restored copy:** checksums, migration ledger (names + SHA-256
   against the deployed commit), constraints and RLS, row counts against latest
   known-good metrics, outbox/inbox consistency, S3 object references, and
   application smoke tests. **Redis is never an input to restore.**
5. **Decision point — verification passed?** If not, pick an earlier recovery
   point and repeat from step 3.
6. **Pre-open safety sequence (mandatory order, Database.md §12):**
   1. Apply deletion-suppression tombstones from the encrypted suppression ledger.
   2. Rotate database credentials.
   3. Keep outbox publishing disabled.
   4. Reconcile Stripe (`billing-reconciliation.md`) against the restored state.
   5. Validate Cognito linkage (user rows ↔ identity subjects).
   6. Resume outbox publishers from a recorded boundary — no duplicate or lost
      event effects (consumers dedupe via inbox, but the boundary must be recorded).
7. **Cut over traffic** to the restored cluster and re-enable workers in
   dependency order: TODO(owner) — order and commands.

## Verification

- Application smoke tests pass against the restored production: TODO(owner).
- RLS positive/negative checks pass; runtime roles cannot bypass RLS.
- Outbox/inbox drain cleanly; no critical queue exceeds the 5-minute age alert.
- Achieved RPO and RTO are measured and recorded (Gate G4 requires demonstrated
  PITR with achieved RPO ≤ 5 min and documented recovery time).

## Rollback / escape

- Until cutover, the original cluster (if intact) remains the fallback — do not
  destroy it until the restored cluster has passed verification and soak:
  TODO(owner) — soak duration.
- If the restored state is unusable, escalate to cross-account/cross-region
  copies (older recovery points, larger data loss window; document it).
- Logical exports are for portability, not primary recovery.

## Communication

- Users: downtime/status messaging: TODO(owner).
- If the data-loss window includes user actions (attempts, purchases), privacy
  and support owners define user-facing remediation: TODO(owner).
- Regulatory assessment with the privacy owner if personal data was lost or the
  cause was a security event.

## Post-incident evidence to retain

- Recovery-point decision, restore timeline, achieved RPO/RTO.
- Verification results (checksums, migration ledger, RLS, row counts,
  outbox/inbox, S3 references, smoke tests).
- Evidence of the pre-open sequence: tombstone replay, credential rotation,
  Stripe reconciliation run IDs, Cognito validation, publisher resume boundary.
- CloudTrail records of restore-role usage; postmortem with action items.
