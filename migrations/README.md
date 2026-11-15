# migrations/

Explicit, forward-only SQL migrations for PostgreSQL 16 (ADR-009, ADR-012;
`docs/Database.md`). Filenames must match `^\d{4}_[a-z0-9_]+\.sql$`.

## Current files

| File | Purpose |
|---|---|
| `0001_extensions_roles.sql` | Extensions, capability schemas, `dm_*` roles (incl. `dm_security`), ledger (DM-020) |
| `0002_enums.sql` | Capability-owned enums |
| `0003_iam_core.sql` | `iam.users`, identities, roles |
| `0004_media.sql` | `media.objects` |
| `0005_iam_legal.sql` | Legal document versions, consent events |
| `0006_content.sql` | Immutable curriculum graph |
| `0007_learner.sql` | Profiles, onboarding, proficiency |
| `0008_learning_core.sql` | Sessions, attempts, scores, evidence, review, progress |
| `0009_ai.sql` | Prompts, releases, threads, runs, traces, LangGraph |
| `0010_learning_feedback.sql` | Feedback records (FK to `ai.runs`) |
| `0011_ops.sql` | Idempotency, outbox, inbox, audit |
| `0012_billing.sql` | Plans, Stripe lifecycle, entitlements, webhooks |
| `0013_privacy_support.sql` | Privacy requests/tasks, support cases |
| `0014_immutability.sql` | `ops.forbid_mutation` and published-mapping guards |
| `0015_indexes.sql` | Secondary indexes from Database.md §5 |
| `0016_rls_grants.sql` | RLS helpers/policies, published views, capability grants (DM-022) |
| `0017_identity_provision.sql` | `ops.resolve_or_provision_user` security-definer bootstrap (DM-035) |
| `0018_content_rollback_transition.sql` | Allow retired→published for curriculum/AI rollback reselection (DM-031) |
| `0019_published_curriculum_views.sql` | Published module/lesson/activity views for learner delivery (DM-032) |

RLS is enforced and forced on user-owned and child-owned tables. No assessment,
speaking, reminder, conversation-history, or native-IAP tables.

## Runner rules

- SHA-256 of exact file bytes is recorded in `ops.schema_migrations`.
- Changing an already-applied file’s bytes is rejected.
- Each migration runs in a transaction with lock/statement timeouts.
- After `0001`, later migrations execute as `SET LOCAL ROLE dm_migrator`.
- ORM auto-sync, `db push`, runtime DDL, and destructive rollback are forbidden
  (`docs/CODING_STANDARDS.md` §10).

```sh
pnpm db:reset
pnpm db:contract && pnpm db:constraints && pnpm db:immutability && pnpm db:rls
pnpm test:authorization
pnpm db:codegen   # refreshes packages/database/src/generated/
```
