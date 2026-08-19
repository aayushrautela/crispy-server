-- 0051: make identity.accounts.email authoritative from auth.users (root-level fix)
--
-- Root cause: identity.accounts.email was never reliably kept in sync with the
-- authoritative auth email. Provisioning only set it from the login JWT email
-- claim (COALESCE keeps the existing value when the claim is absent), so stale
-- placeholder emails (e.g. "a@b.com") could persist indefinitely and the admin
-- lookup-by-email would never match the real auth email.
--
-- This migration:
--   1) Backfills any mismatched/empty identity.accounts.email from auth.users.
--   2) Replaces identity.upsert_account so it self-heals the email from the
--      authoritative auth.users source whenever the caller does not supply one,
--      instead of silently keeping a stale value.

-- 1) One-off backfill of mismatched/empty emails from the authoritative source.
UPDATE identity.accounts a
SET email = u.email,
    updated_at = now()
FROM auth.users u
WHERE u.id = a.id
  AND u.email IS NOT NULL
  AND (a.email IS DISTINCT FROM u.email);

-- 2) Self-healing upsert_account.
CREATE OR REPLACE FUNCTION identity.upsert_account(
  p_account_id uuid,
  p_email text DEFAULT NULL,
  p_display_name text DEFAULT NULL
)
RETURNS identity.accounts
LANGUAGE plpgsql
AS $$
DECLARE
  v_account identity.accounts;
  v_auth_email text := NULL;
BEGIN
  -- Best-effort: prefer the explicitly provided email; otherwise fall back to
  -- the authoritative auth.users email so stale placeholders self-heal. The
  -- nested block keeps the function resilient if auth.users is unreachable.
  BEGIN
    SELECT u.email INTO v_auth_email
    FROM auth.users u
    WHERE u.id = p_account_id;
  EXCEPTION WHEN OTHERS THEN
    v_auth_email := NULL;
  END;

  p_email := COALESCE(NULLIF(p_email, ''), v_auth_email, (SELECT a.email FROM identity.accounts a WHERE a.id = p_account_id));

  INSERT INTO identity.accounts (id, email, display_name, last_seen_at, updated_at)
  VALUES (p_account_id, p_email, p_display_name, now(), now())
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(NULLIF(EXCLUDED.email, ''), identity.accounts.email),
    display_name = COALESCE(EXCLUDED.display_name, identity.accounts.display_name),
    last_seen_at = now(),
    updated_at = now(),
    deleted_at = NULL
  RETURNING * INTO v_account;

  INSERT INTO identity.account_preferences (account_id)
  VALUES (v_account.id)
  ON CONFLICT (account_id) DO NOTHING;

  INSERT INTO identity.account_entitlements (account_id)
  VALUES (v_account.id)
  ON CONFLICT (account_id) DO NOTHING;

  RETURN v_account;
END;
$$;
