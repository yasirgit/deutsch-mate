# infra/

Home of the single pinned IaC toolchain (AWS CDK or Terraform) selected by
DM-005 (ADR-007, ADR-019). Exactly one tool manages each resource across
isolated dev/staging/prod accounts in the EU primary region.

Owned by the platform lane (Epics 1-2). Intentionally empty at DM-001; do not
add ad-hoc infrastructure definitions before DM-005 records the toolchain ADR.
