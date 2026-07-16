-- Migration 0011: rename identity.profiles.avatar_key -> avatar_url
-- The column held an avatar identifier; it now stores a full avatar URL
-- (validated as a Dicebear URL at the application layer on write).

ALTER TABLE identity.profiles RENAME COLUMN avatar_key TO avatar_url;
