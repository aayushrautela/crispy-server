-- Phase 5: Rename content_id to media_key in app signal tables
-- This is a destructive migration that directly renames columns in app signal tables
-- to complete the mediaKey migration (phases 0-4 already migrated API/domain layer)

ALTER TABLE app_profile_history_signals
  RENAME COLUMN content_id TO media_key;

ALTER TABLE app_profile_rating_signals
  RENAME COLUMN content_id TO media_key;

ALTER TABLE app_profile_watchlist_signals
  RENAME COLUMN content_id TO media_key;

ALTER TABLE app_profile_continue_watching_signals
  RENAME COLUMN content_id TO media_key;
