-- DM-035: security-definer identity resolve/provision (RLS bootstrap).
-- First-login cannot INSERT iam.user_roles under learner RLS (admin-only
-- manage policy), and identity lookup needs issuer/subject before app.user_id
-- exists. ops.resolve_or_provision_user runs as dm_security (BYPASSRLS).

SET LOCAL ROLE dm_migrator;

-- dm_security owns provision helpers (BYPASSRLS) but still needs table grants.
GRANT SELECT, INSERT, UPDATE ON iam.users TO dm_security;
GRANT SELECT, INSERT, UPDATE ON iam.user_identities TO dm_security;
GRANT SELECT, INSERT ON iam.user_roles TO dm_security;

CREATE OR REPLACE FUNCTION ops.resolve_or_provision_user(
  p_issuer text,
  p_subject text,
  p_email text,
  p_email_verified boolean,
  p_candidate_user_id uuid,
  p_candidate_identity_id uuid,
  p_candidate_role_id uuid,
  p_pseudonym_key uuid
)
RETURNS TABLE (
  out_user_id uuid,
  out_status iam.account_status,
  out_roles text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, iam
AS $$
DECLARE
  v_user_id uuid;
  v_status iam.account_status;
  v_roles text[];
BEGIN
  IF p_issuer IS NULL OR length(trim(p_issuer)) = 0 THEN
    RAISE EXCEPTION 'issuer required';
  END IF;
  IF p_subject IS NULL OR length(trim(p_subject)) = 0 THEN
    RAISE EXCEPTION 'subject required';
  END IF;

  SELECT ui.user_id
  INTO v_user_id
  FROM iam.user_identities AS ui
  WHERE ui.issuer = p_issuer
    AND ui.subject = p_subject;

  IF v_user_id IS NULL THEN
    BEGIN
      INSERT INTO iam.users (
        id,
        status,
        primary_email,
        pseudonym_key
      )
      VALUES (
        p_candidate_user_id,
        'active'::iam.account_status,
        NULLIF(lower(trim(p_email)), '')::citext,
        p_pseudonym_key
      );

      INSERT INTO iam.user_identities (
        id,
        user_id,
        issuer,
        subject,
        email_verified,
        last_authenticated_at
      )
      VALUES (
        p_candidate_identity_id,
        p_candidate_user_id,
        p_issuer,
        p_subject,
        coalesce(p_email_verified, false),
        now()
      );

      INSERT INTO iam.user_roles (
        id,
        user_id,
        role,
        reason
      )
      VALUES (
        p_candidate_role_id,
        p_candidate_user_id,
        'learner'::iam.role_code,
        'oidc_first_login_provision'
      );

      v_user_id := p_candidate_user_id;
    EXCEPTION
      WHEN unique_violation THEN
        -- Concurrent first login won the (issuer, subject) race.
        SELECT ui.user_id
        INTO v_user_id
        FROM iam.user_identities AS ui
        WHERE ui.issuer = p_issuer
          AND ui.subject = p_subject;

        IF v_user_id IS NULL THEN
          RAISE;
        END IF;
    END;
  ELSE
    UPDATE iam.user_identities AS ui
    SET
      email_verified = coalesce(p_email_verified, ui.email_verified),
      last_authenticated_at = now(),
      updated_at = now(),
      lock_version = ui.lock_version + 1
    WHERE ui.issuer = p_issuer
      AND ui.subject = p_subject;

    -- Refresh primary email when Cognito provides one and the row is empty.
    IF p_email IS NOT NULL AND length(trim(p_email)) > 0 THEN
      UPDATE iam.users AS u
      SET
        primary_email = coalesce(u.primary_email, lower(trim(p_email))::citext),
        updated_at = now()
      WHERE u.id = v_user_id
        AND u.primary_email IS NULL;
    END IF;
  END IF;

  SELECT u.status
  INTO v_status
  FROM iam.users AS u
  WHERE u.id = v_user_id;

  SELECT coalesce(
    array_agg(r.role::text ORDER BY r.role::text),
    ARRAY[]::text[]
  )
  INTO v_roles
  FROM iam.user_roles AS r
  WHERE r.user_id = v_user_id
    AND r.revoked_at IS NULL;

  out_user_id := v_user_id;
  out_status := v_status;
  out_roles := v_roles;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION ops.resolve_or_provision_user(
  text, text, text, boolean, uuid, uuid, uuid, uuid
) IS
  'OIDC bootstrap: find or create iam.users + identity + learner role (DM-035). '
  'Bypasses RLS via dm_security owner; dm_api EXECUTE only.';

RESET ROLE;
ALTER FUNCTION ops.resolve_or_provision_user(
  text, text, text, boolean, uuid, uuid, uuid, uuid
) OWNER TO dm_security;
SET LOCAL ROLE dm_migrator;

REVOKE ALL ON FUNCTION ops.resolve_or_provision_user(
  text, text, text, boolean, uuid, uuid, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.resolve_or_provision_user(
  text, text, text, boolean, uuid, uuid, uuid, uuid
) TO dm_api;

-- Read product user + active roles regardless of account status so the API can
-- return 403 account_access_denied instead of a misleading RLS miss.
CREATE OR REPLACE FUNCTION ops.get_product_user(p_user_id uuid)
RETURNS TABLE (
  out_user_id uuid,
  out_status iam.account_status,
  out_primary_email citext,
  out_interface_locale varchar(16),
  out_country_code char(2),
  out_birth_year smallint,
  out_age_gate_confirmed_at timestamptz,
  out_lock_version integer,
  out_created_at timestamptz,
  out_updated_at timestamptz,
  out_roles text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, iam
AS $$
DECLARE
  v_roles text[];
BEGIN
  SELECT coalesce(
    array_agg(r.role::text ORDER BY r.role::text),
    ARRAY[]::text[]
  )
  INTO v_roles
  FROM iam.user_roles AS r
  WHERE r.user_id = p_user_id
    AND r.revoked_at IS NULL;

  RETURN QUERY
  SELECT
    u.id,
    u.status,
    u.primary_email,
    u.interface_locale,
    u.country_code,
    u.birth_year,
    u.age_gate_confirmed_at,
    u.lock_version,
    u.created_at,
    u.updated_at,
    v_roles
  FROM iam.users AS u
  WHERE u.id = p_user_id;
END;
$$;

COMMENT ON FUNCTION ops.get_product_user(uuid) IS
  'Load iam.users + active roles bypassing RLS for account-state enforcement (DM-035).';

RESET ROLE;
ALTER FUNCTION ops.get_product_user(uuid) OWNER TO dm_security;
SET LOCAL ROLE dm_migrator;

REVOKE ALL ON FUNCTION ops.get_product_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.get_product_user(uuid) TO dm_api;
