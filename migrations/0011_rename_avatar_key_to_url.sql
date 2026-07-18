-- Migration 0011: rename identity.profiles.avatar_key -> avatar_url
-- The column held an avatar identifier; it now stores a full avatar URL
-- (validated as a Dicebear URL at the application layer on write).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'identity' AND table_name = 'profiles' AND column_name = 'avatar_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'identity' AND table_name = 'profiles' AND column_name = 'avatar_url'
  ) THEN
    ALTER TABLE identity.profiles RENAME COLUMN avatar_key TO avatar_url;
  END IF;
END $$;
