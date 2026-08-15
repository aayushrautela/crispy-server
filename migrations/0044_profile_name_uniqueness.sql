-- Prevent duplicate profile names within an account (case/space-insensitive),
-- and collapse any pre-existing duplicates created by the race-prone
-- auto-bootstrap that ran on every authenticated request.
--
-- The application now creates the first profile with an atomic
-- `INSERT ... ON CONFLICT DO NOTHING`, so this index is the authoritative
-- backstop that closes the time-of-check/time-of-use window.

-- 1) Dedupe: keep the earliest live profile per (account_id, lower(trim(name))),
--    soft-delete the rest. Idempotent and safe to re-run.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY account_id, lower(trim(name))
           ORDER BY sort_order ASC, created_at ASC, id ASC
         ) AS rn
  FROM identity.profiles
  WHERE deleted_at IS NULL
)
UPDATE identity.profiles p
SET deleted_at = now(),
    updated_at = now()
WHERE p.id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) Enforce uniqueness of live profile names per account.
--    The expression normalizes the natural key so "Aayush " and "aayush"
--    cannot both exist. The partial predicate scopes to non-deleted rows
--    only, matching how the application filters.
CREATE UNIQUE INDEX identity_profiles_account_name_uniq
  ON identity.profiles (account_id, lower(trim(name)))
  WHERE deleted_at IS NULL;
