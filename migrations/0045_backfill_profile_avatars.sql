-- Backfill profile avatars: migrate any legacy DiceBear URLs / NULLs to the
-- server-owned avatar catalog (avatar_01..avatar_20).
--
-- The application now serves avatars only from its own bundled catalog
-- (GET /v1/avatars/:id) and validates avatar_url against SUPPORTED_AVATARS on
-- write (see src/modules/profiles/avatars.ts). Profiles created before this
-- catalog existed may still hold NULL or an old external DiceBear URL
-- (e.g. "https://api.dicebear.com/..."), which the client cannot render. This
-- migration normalizes them to a random supported server-owned avatar id.
--
-- Idempotent: only rows whose avatar_url is NULL, empty, or not in the
-- supported set are touched, so re-running is safe and a no-op once
-- normalized.

UPDATE identity.profiles
SET
  avatar_url = (
    ARRAY[
      'avatar_01', 'avatar_02', 'avatar_03', 'avatar_04', 'avatar_05',
      'avatar_06', 'avatar_07', 'avatar_08', 'avatar_09', 'avatar_10',
      'avatar_11', 'avatar_12', 'avatar_13', 'avatar_14', 'avatar_15',
      'avatar_16', 'avatar_17', 'avatar_18', 'avatar_19', 'avatar_20'
    ]
  )[1 + floor(random() * 20)::int],
  updated_at = now()
WHERE deleted_at IS NULL
  AND (
    avatar_url IS NULL
    OR avatar_url = ''
    OR avatar_url NOT IN (
      'avatar_01', 'avatar_02', 'avatar_03', 'avatar_04', 'avatar_05',
      'avatar_06', 'avatar_07', 'avatar_08', 'avatar_09', 'avatar_10',
      'avatar_11', 'avatar_12', 'avatar_13', 'avatar_14', 'avatar_15',
      'avatar_16', 'avatar_17', 'avatar_18', 'avatar_19', 'avatar_20'
    )
  );
