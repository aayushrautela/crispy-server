-- Admin (main) profile flag and per-profile 4-digit PIN lock.
--
-- Introduces the Netflix-style main profile concept: the first profile on
-- an account is the admin profile. Adds per-profile PIN lock storage with
-- brute-force lockout counters, and an admin-gated "require pin to add
-- profiles" policy.

ALTER TABLE identity.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS pin_failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS require_pin_to_add_profiles boolean NOT NULL DEFAULT false;

-- Backfill: mark the first profile per account (lowest sort_order, then
-- earliest created_at) as admin. Idempotent and safe on empty accounts.
UPDATE identity.profiles AS p
SET is_admin = true,
    updated_at = now()
WHERE p.deleted_at IS NULL
  AND NOT p.is_admin
  AND p.id IN (
    SELECT DISTINCT ON (account_id) id
    FROM identity.profiles
    WHERE deleted_at IS NULL
    ORDER BY account_id, sort_order ASC, created_at ASC, id ASC
  );

-- At most one admin profile per account.
CREATE UNIQUE INDEX IF NOT EXISTS identity_profiles_admin_per_account_uidx
  ON identity.profiles (account_id)
  WHERE is_admin AND deleted_at IS NULL;

-- Defensive constraints.
ALTER TABLE identity.profiles
  ADD CONSTRAINT identity_profiles_pin_hash_length_chk
    CHECK (pin_hash IS NULL OR length(pin_hash) BETWEEN 20 AND 100),
  ADD CONSTRAINT identity_profiles_pin_failed_attempts_chk
    CHECK (pin_failed_attempts >= 0),
  ADD CONSTRAINT identity_profiles_sort_order_chk
    CHECK (sort_order >= 0);

-- Token-hash helper already imported for PATs lives in private schema;
-- PIN hashing uses bcrypt on the application side, so no DB-side crypto needed.
