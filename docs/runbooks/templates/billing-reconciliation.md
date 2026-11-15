# Runbook template — Billing reconciliation and entitlement mismatch

> **Template status:** skeleton for DM-004. Instantiate as
> `docs/runbooks/billing-reconciliation.md` when DM-054/DM-062 complete it.
> Replace every `TODO(owner)` before operational use (MVP Gates G6, G8).
> Source contracts: ADR-016; `docs/Database.md` §4.7 (`billing.reconciliation_runs`,
> `billing.reconciliation_items`, `billing.webhook_events`); MVP_SCOPE Gate G6.

## Purpose

Operate the scheduled Stripe↔internal reconciliation, and repair or escalate
subscription/entitlement mismatches so that provider state and product access
converge within 24 hours without synchronous Stripe calls in product requests or
any card-data exposure.

## Owner role

- **Primary:** TODO(owner) — billing operations owner.
- **Security owner** joins for suspected webhook abuse or signature failures.

## Preconditions

- Read access to `billing.reconciliation_runs`, `billing.reconciliation_items`,
  `billing.webhook_events`, `billing.subscriptions`, `billing.entitlements`,
  and `billing.entitlement_events`: TODO(owner) — access path.
- Stripe Dashboard read access for the correct environment account (never mix
  environments; separate Stripe credentials per ADR-019): TODO(owner).
- Replay tooling for the webhook DLQ: TODO(owner).

## Detection and alerts

- The daily reconciliation job must complete within 24 hours or page billing
  operations (Database.md §4.7).
- Alerts: entitlement mismatch detected (`resolution = 'alerted'`), reconciliation
  run `failed`, webhook processing `dead_letter`, webhook signature failures.
- Dashboard links and alert names: TODO(owner).

## Procedure

1. **Locate the run.** Inspect the latest `billing.reconciliation_runs` row:
   status, `checked_count`, `mismatch_count`, `repaired_count`, `alerted_count`,
   `last_error`.
2. **Decision point — did the run fail or stall?**
   - Restart/resume from the recorded `cursor`; if repeated failures, treat as an
     incident (`incident-response.md`). Restart command: TODO(owner).
3. **Triage alerted mismatches** in `billing.reconciliation_items` by
   `mismatch_code`. Compare `internal_snapshot` vs `provider_snapshot`.
4. **Decision point — which side is authoritative?**
   - Stripe is authoritative for subscription/payment state; internal PostgreSQL
     entitlements are authoritative for product access. Repair means converging
     the entitlement to verified provider state via an append-only
     `billing.entitlement_events` row with `action = 'reconcile'` — never a manual
     row edit.
5. **Check for stuck webhooks.** Reordered/delayed events compare provider object
   version/creation time and refresh from Stripe when ambiguous; duplicates are
   deduped on `UQ(provider, provider_event_id)`. Replay dead-lettered events after
   fixing the cause — DLQ replay never deletes ledger evidence.
6. **Decision point — user-impacting access error?** If a paying user lacks
   access, prioritize the entitlement repair; if a non-paying user has access,
   repair and assess scope/duration for follow-up.
7. **Never** store or copy card data, call Stripe from ordinary product request
   paths, or grant entitlements from a browser redirect.

## Verification

- Re-run reconciliation for the affected customer scope; mismatch resolves as
  `repaired` or `no_change`. Command: TODO(owner).
- Affected user's product access matches their subscription state end to end.
- One provider event produced at most one effective entitlement transition
  (Gate G6 invariant).

## Rollback / escape

- An incorrect repair is corrected by appending a superseding entitlement event —
  the ledger is append-only; never rewrite `entitlement_events` or
  `reconciliation_items`.
- Escalate to the billing engineering owner if a `mismatch_code` indicates a
  systematic processing bug rather than provider event disorder: TODO(owner).

## Communication

- User-impacting entitlement errors: support notification templates and refund/
  credit policy: TODO(owner).
- Systematic mismatches or suspected abuse: billing + security owners,
  incident channel.

## Post-incident evidence to retain

- `reconciliation_runs`/`reconciliation_items` rows (durable by design) and the
  `entitlement_events` appended as repairs.
- Webhook ledger state for the affected events (IDs and statuses; payloads stay
  in the database, not in tickets).
- Root-cause note and, for systematic bugs, the tracked issue and regression test.
