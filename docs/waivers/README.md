# Waivers

This directory holds all active and historical waivers of normative rules.

Per `docs/CODING_STANDARDS.md` §1, a `MUST` exception requires a **time-bounded,
owner-named waiver** in the pull request and approval from the relevant security,
privacy, data, or architecture owner. CI, review, and release evidence enforce the
standards; a waiver is the only legitimate way to ship a known exception, and
hidden waivers are prohibited (§17/§20: no temporary bypass, TODO, disabled test,
or waiver without an owner, tracked issue, and expiry).

## Required fields

Every waiver MUST record all of the following:

| Field | Meaning |
|---|---|
| **Rule waived** | The exact rule, cited by document and section (e.g. `CODING_STANDARDS §10 — concurrent index creation`). |
| **Reason** | Why compliance is not possible now, and what compensating control limits the risk. |
| **Owner** | A named individual accountable for removing the waiver. |
| **Expiry date** | A hard date (ISO 8601). Keep it short; renewal requires a new approval, not an edit. |
| **Tracking issue** | Link to the issue that tracks remediation to full compliance. |
| **Approver role** | Which owner role approved (security, privacy, data, or architecture) and who exercised it. The approver must own the waived risk and must not be the change author. |

## Storage convention

- **One file per waiver** in this directory: `WVR-NNN-<short-slug>.md`
  (e.g. `WVR-001-defer-container-scan.md`). Numbers are sequential and never reused.
- The waiving pull request links the waiver file, and the waiver file links back
  to the PR.
- Expired or remediated waivers are not deleted: set their status to
  `expired` or `closed` so the history remains auditable.

### Waiver file skeleton

```markdown
# WVR-NNN — <title>

- **Status:** active | expired | closed
- **Rule waived:** <document §section — rule>
- **Reason:** <why, plus compensating control>
- **Owner:** <name>
- **Expiry date:** <YYYY-MM-DD>
- **Tracking issue:** <link>
- **Approver role:** <security | privacy | data | architecture> — <approver name>
- **Pull request:** <link>
```

## Release rule

**An expired waiver blocks release.** Release verification checks every waiver in
this directory: any waiver whose expiry date has passed and whose status is still
`active` fails `pnpm release:verify`, and the release evidence record must list all
waivers in effect. Extending a waiver requires a fresh approval from the owning
role and a new expiry — never a silent date edit.
