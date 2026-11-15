-- DM-020: extensions, capability schemas, least-privilege roles, migration ledger.
-- docs/Database.md §2.1, §8, §12; ADR-009; CODING_STANDARDS §10.
--
-- NOLOGIN roles only — local LOGIN passwords are applied by the migrate script
-- from env (never stored in SQL). Table grants for MVP tables arrive in DM-021/022.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS learner;
CREATE SCHEMA IF NOT EXISTS media;
CREATE SCHEMA IF NOT EXISTS content;
CREATE SCHEMA IF NOT EXISTS learning;
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS privacy;
CREATE SCHEMA IF NOT EXISTS support;
CREATE SCHEMA IF NOT EXISTS ops;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_migrator') THEN
    CREATE ROLE dm_migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_api') THEN
    CREATE ROLE dm_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_ai_worker') THEN
    CREATE ROLE dm_ai_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_billing_worker') THEN
    CREATE ROLE dm_billing_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_media_worker') THEN
    CREATE ROLE dm_media_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_privacy_worker') THEN
    CREATE ROLE dm_privacy_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_outbox_worker') THEN
    CREATE ROLE dm_outbox_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_read_replica') THEN
    CREATE ROLE dm_read_replica NOLOGIN;
  END IF;
  -- Owns security-definer RLS helpers; BYPASSRLS only for those helpers.
  -- Never granted to runtime roles (docs/Database.md §8).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_security') THEN
    CREATE ROLE dm_security NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- Session user (deployment / local owner) may SET ROLE dm_migrator for DDL.
GRANT dm_migrator TO CURRENT_USER;

CREATE TABLE IF NOT EXISTS ops.schema_migrations (
  name text NOT NULL,
  sha256 char(64) NOT NULL,
  deployed_commit text,
  actor text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schema_migrations_name_key UNIQUE (name),
  CONSTRAINT schema_migrations_sha256_hex CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

REVOKE ALL ON TABLE ops.schema_migrations FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE ops.schema_migrations TO dm_migrator;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $$
DECLARE
  db_name text := current_database();
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dm_migrator', db_name);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dm_api', db_name);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dm_ai_worker', db_name);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dm_billing_worker', db_name);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dm_media_worker', db_name);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dm_privacy_worker', db_name);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dm_outbox_worker', db_name);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dm_read_replica', db_name);
END
$$;

GRANT USAGE, CREATE ON SCHEMA iam TO dm_migrator;
GRANT USAGE, CREATE ON SCHEMA learner TO dm_migrator;
GRANT USAGE, CREATE ON SCHEMA media TO dm_migrator;
GRANT USAGE, CREATE ON SCHEMA content TO dm_migrator;
GRANT USAGE, CREATE ON SCHEMA learning TO dm_migrator;
GRANT USAGE, CREATE ON SCHEMA ai TO dm_migrator;
GRANT USAGE, CREATE ON SCHEMA billing TO dm_migrator;
GRANT USAGE, CREATE ON SCHEMA privacy TO dm_migrator;
GRANT USAGE, CREATE ON SCHEMA support TO dm_migrator;
GRANT USAGE, CREATE ON SCHEMA ops TO dm_migrator;

GRANT USAGE ON SCHEMA iam TO dm_api;
GRANT USAGE ON SCHEMA learner TO dm_api;
GRANT USAGE ON SCHEMA media TO dm_api;
GRANT USAGE ON SCHEMA content TO dm_api;
GRANT USAGE ON SCHEMA learning TO dm_api;
GRANT USAGE ON SCHEMA ai TO dm_api;
GRANT USAGE ON SCHEMA billing TO dm_api;
GRANT USAGE ON SCHEMA privacy TO dm_api;
GRANT USAGE ON SCHEMA support TO dm_api;
GRANT USAGE ON SCHEMA ops TO dm_api;

GRANT USAGE ON SCHEMA ai TO dm_ai_worker;
GRANT USAGE ON SCHEMA learner TO dm_ai_worker;
GRANT USAGE ON SCHEMA content TO dm_ai_worker;
GRANT USAGE ON SCHEMA learning TO dm_ai_worker;
GRANT USAGE ON SCHEMA ops TO dm_ai_worker;

GRANT USAGE ON SCHEMA billing TO dm_billing_worker;
GRANT USAGE ON SCHEMA ops TO dm_billing_worker;

GRANT USAGE ON SCHEMA media TO dm_media_worker;
GRANT USAGE ON SCHEMA ops TO dm_media_worker;

GRANT USAGE ON SCHEMA privacy TO dm_privacy_worker;
GRANT USAGE ON SCHEMA iam TO dm_privacy_worker;
GRANT USAGE ON SCHEMA ops TO dm_privacy_worker;

GRANT USAGE ON SCHEMA ops TO dm_outbox_worker;

GRANT USAGE ON SCHEMA ops TO dm_read_replica;
