-- DM-021: iam users, identities, roles (docs/Database.md §4.1).
-- media.objects and legal/consent follow after media exists.

CREATE TABLE iam.users (
  id uuid PRIMARY KEY,
  status iam.account_status NOT NULL DEFAULT 'active',
  primary_email citext NULL,
  interface_locale varchar(16) NOT NULL DEFAULT 'en',
  country_code char(2) NULL,
  birth_year smallint NULL,
  age_gate_confirmed_at timestamptz NULL,
  pseudonym_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz NULL,
  CONSTRAINT users_birth_year_ck CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100),
  CONSTRAINT users_lock_version_ck CHECK (lock_version > 0),
  CONSTRAINT users_pseudonym_key_key UNIQUE (pseudonym_key)
);

CREATE UNIQUE INDEX users_primary_email_uidx
  ON iam.users (primary_email)
  WHERE primary_email IS NOT NULL;

CREATE TABLE iam.user_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  issuer text NOT NULL,
  subject text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  last_authenticated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT user_identities_lock_version_ck CHECK (lock_version > 0),
  CONSTRAINT user_identities_issuer_subject_key UNIQUE (issuer, subject)
);

CREATE INDEX user_identities_user_id_idx ON iam.user_identities (user_id);

CREATE TABLE iam.user_roles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  role iam.role_code NOT NULL,
  granted_by uuid NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  revoked_at timestamptz NULL,
  reason text NOT NULL,
  CONSTRAINT user_roles_revoke_order_ck CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE UNIQUE INDEX user_roles_active_uidx
  ON iam.user_roles (user_id, role)
  WHERE revoked_at IS NULL;

CREATE INDEX user_roles_user_id_idx ON iam.user_roles (user_id);
CREATE INDEX user_roles_granted_by_idx ON iam.user_roles (granted_by);
CREATE INDEX user_roles_revoked_by_idx ON iam.user_roles (revoked_by);
