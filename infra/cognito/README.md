# Cognito / OIDC configuration (DM-035)

Cognito User Pool provisioning depends on DM-005 (IaC toolchain) and DM-006
(network/security foundations). This document is the **config contract** for
the pool and app clients to create later — not a competing IaC toolchain.

Deutsch Mate never stores local passwords or refresh/access tokens in the
product database. Cognito owns registration, email verification, sign-in,
sign-out, and password recovery. The Product API verifies short-lived OIDC
access tokens and resolves/provisions `iam.users` + `iam.user_identities`.

## Environment (Product API)

| Variable | Required | Notes |
|---|---|---|
| `OIDC_ISSUER` | yes | e.g. `https://cognito-idp.eu-central-1.amazonaws.com/<userPoolId>` |
| `OIDC_AUDIENCE` | yes | App client ID (audience claim) |
| `OIDC_JWKS_URI` | no | Defaults to `{OIDC_ISSUER}/.well-known/jwks.json` |

Issuer and audience are **configuration**, not secrets. In production, any
optional secret material (if ever needed) uses Secrets Manager + workload
identity; do not put Cognito client secrets in process env (SPA/native clients
are public and must not have a client secret).

## User Pool settings (to provision under DM-005/DM-006)

- **Region:** EU primary (same as the workload account).
- **Sign-in:** email (username = email is acceptable).
- **Password policy:** Cognito-managed; product never persists passwords.
- **Email verification:** required before product access is meaningful
  (`email_verified` claim).
- **Password recovery:** Cognito hosted recovery / forgot-password flows only.
- **MFA:** optional for MVP; do not block adult self-learners on MFA.
- **Hosted UI:** optional for web; Authorization Code + PKCE remains mandatory
  whether using Hosted UI or a custom authorize endpoint.

## App clients (public)

Create separate public clients for web SPA and native mobile as needed:

- **OAuth 2.0 flow:** Authorization Code **with PKCE** only.
- **No client secret** (public SPA / native).
- **Allowed callback / logout URLs:** environment-specific HTTPS origins.
- **Scopes:** `openid`, `email`, `profile` (add custom scopes only when the
  OpenAPI security scheme requires them; product scopes such as
  `profile:read` / `profile:write` are application authorization layers, not
  Cognito resource-server scopes unless explicitly introduced later).
- **Token validity:** short-lived access tokens (recommend ≤ 1 hour); refresh
  tokens stay in the client SDK / secure storage, never in PostgreSQL.
- **ID token:** used by clients for UX claims; Product API authorizes on the
  **access token** (issuer, audience, signature via JWKS, `exp`, alg allowlist
  `RS256`/`ES256`).

## Product API verification checklist

1. Fetch JWKS from `OIDC_JWKS_URI` or derived issuer JWKS URL.
2. Verify signature, `iss`, `aud` (app client id), `exp`, and algorithm
   allowlist (`RS256`, `ES256`).
3. Extract `sub`, `iss`, `email`, `email_verified`.
4. Resolve or provision `iam.user_identities` / `iam.users` (no password/token
   columns).
5. Deny product access when `iam.users.status` is `blocked`, `deleted`, or
   `deletion_pending` (**403** `account_access_denied` — authentication
   succeeded; the account is not allowed product use).

## Out of scope here

- CDK/Terraform resources (DM-005).
- VPC / WAF / Secrets Manager wiring (DM-006+).
- Full privacy export / Cognito AdminUserGlobalSignOut orchestration (DM-050);
  DM-035 only transitions product status to `deletion_pending`.
