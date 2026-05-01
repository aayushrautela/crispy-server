-- Compatibility alias for service recommendation ownership queries.
--
-- Migration 0048 created app_source_ownership.app_id as the owning app id, while
-- deployed service recommendation list code reads app_source_ownership.owner_app_id.
-- Keep app_id as the canonical column for existing repositories and expose
-- owner_app_id as a generated alias for compatibility.

DO $$
BEGIN
  IF to_regclass('public.app_source_ownership') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'app_source_ownership'
         AND column_name = 'owner_app_id'
     ) THEN
    ALTER TABLE public.app_source_ownership
      ADD COLUMN owner_app_id text GENERATED ALWAYS AS (app_id) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS app_source_ownership_owner_app_idx
  ON app_source_ownership (owner_app_id, status);
