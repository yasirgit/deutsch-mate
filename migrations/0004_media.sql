-- DM-021: media.objects (docs/Database.md §4.3).
-- Depends on iam.users; legal_document_versions FKs this table.

CREATE TABLE media.objects (
  id uuid PRIMARY KEY,
  owner_user_id uuid NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
  data_class media.data_class NOT NULL,
  bucket_alias varchar(40) NOT NULL,
  object_key text NOT NULL,
  s3_version_id text NULL,
  state media.object_state NOT NULL DEFAULT 'pending_upload',
  content_type text NOT NULL,
  size_bytes bigint NULL,
  sha256 char(64) NULL,
  kms_key_alias varchar(100) NOT NULL,
  retention_until timestamptz NULL,
  legal_hold boolean NOT NULL DEFAULT false,
  available_at timestamptz NULL,
  deletion_requested_at timestamptz NULL,
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT objects_size_bytes_ck CHECK (size_bytes IS NULL OR size_bytes >= 0),
  CONSTRAINT objects_sha256_hex_ck CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT objects_lock_version_ck CHECK (lock_version > 0),
  CONSTRAINT objects_bucket_alias_object_key_key UNIQUE (bucket_alias, object_key)
);

CREATE INDEX objects_owner_user_id_idx ON media.objects (owner_user_id);
