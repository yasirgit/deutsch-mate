-- DM-021: iam legal documents and consent events (docs/Database.md §4.1).

CREATE TABLE iam.legal_document_versions (
  id uuid PRIMARY KEY,
  document_code varchar(40) NOT NULL,
  version integer NOT NULL,
  locale varchar(16) NOT NULL,
  s3_object_id uuid NOT NULL REFERENCES media.objects (id) ON DELETE RESTRICT,
  sha256 char(64) NOT NULL,
  published_at timestamptz NOT NULL,
  effective_at timestamptz NOT NULL,
  retired_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_document_versions_version_ck CHECK (version > 0),
  CONSTRAINT legal_document_versions_document_code_ck CHECK (
    document_code IN ('terms', 'privacy', 'marketing')
  ),
  CONSTRAINT legal_document_versions_sha256_hex_ck CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT legal_document_versions_code_version_locale_key UNIQUE (document_code, version, locale)
);

CREATE INDEX legal_document_versions_s3_object_id_idx
  ON iam.legal_document_versions (s3_object_id);
CREATE INDEX legal_document_versions_created_by_idx
  ON iam.legal_document_versions (created_by);

CREATE TABLE iam.consent_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  document_version_id uuid NULL REFERENCES iam.legal_document_versions (id) ON DELETE RESTRICT,
  purpose_code varchar(40) NOT NULL,
  decision iam.consent_decision NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source varchar(20) NOT NULL,
  ip_hash bytea NULL,
  user_agent_hash bytea NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_events_source_ck CHECK (source IN ('web', 'ios', 'android', 'admin')),
  CONSTRAINT consent_events_document_or_marketing_ck CHECK (
    document_version_id IS NOT NULL OR purpose_code = 'marketing'
  )
);

CREATE INDEX consent_events_document_version_id_idx
  ON iam.consent_events (document_version_id);
CREATE INDEX consent_events_user_id_idx ON iam.consent_events (user_id);
