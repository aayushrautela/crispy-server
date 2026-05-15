-- Retire local user-data tables (migrated to Supabase)
-- Run with caution: data in dropped tables cannot be recovered.
-- Operational tables (service_outbox_events, admin_bulk_jobs) keep their rows but lose FK enforcement.

-- 1. Remove FK constraints from operational tables referencing user tables
ALTER TABLE service_outbox_events DROP CONSTRAINT IF EXISTS service_outbox_events_user_id_fkey;
ALTER TABLE service_outbox_events DROP CONSTRAINT IF EXISTS service_outbox_events_profile_id_fkey;

ALTER TABLE admin_bulk_job_targets ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE admin_bulk_job_targets ALTER COLUMN profile_id DROP NOT NULL;

-- 2. Drop old watch/state tables that are fully in Supabase
DROP TABLE IF EXISTS profile_watch_clock CASCADE;
DROP TABLE IF EXISTS profile_playable_state CASCADE;
DROP TABLE IF EXISTS profile_watch_override CASCADE;
DROP TABLE IF EXISTS profile_watchlist_state CASCADE;
DROP TABLE IF EXISTS profile_rating_state CASCADE;
DROP TABLE IF EXISTS profile_play_history CASCADE;
DROP TABLE IF EXISTS profile_title_projection CASCADE;
DROP TABLE IF EXISTS profile_bulk_operations CASCADE;
DROP TABLE IF EXISTS provider_accounts CASCADE;
DROP TABLE IF EXISTS provider_stream_state CASCADE;
DROP TABLE IF EXISTS provider_outbox CASCADE;
DROP TABLE IF EXISTS trakt_history_shadow CASCADE;
DROP TABLE IF EXISTS trakt_watchlist_shadow CASCADE;
DROP TABLE IF EXISTS trakt_rating_shadow CASCADE;
DROP TABLE IF EXISTS trakt_progress_shadow CASCADE;
DROP TABLE IF EXISTS provider_unresolved_objects CASCADE;

-- 3. Drop old provider-import tables that are in Supabase
DROP TABLE IF EXISTS watch_history_entries CASCADE;
DROP TABLE IF EXISTS provider_import_connections CASCADE;
DROP TABLE IF EXISTS provider_import_jobs CASCADE;
DROP TABLE IF EXISTS profile_watch_data_state CASCADE;
DROP TABLE IF EXISTS provider_history_shadow CASCADE;
DROP TABLE IF EXISTS provider_watchlist_shadow CASCADE;
DROP TABLE IF EXISTS provider_rating_shadow CASCADE;
DROP TABLE IF EXISTS provider_progress_shadow CASCADE;

-- 4. Drop old provider session tables (Supabase has provider_connections, provider_oauth_states)
DROP TABLE IF EXISTS provider_sessions CASCADE;

-- 5. Drop retired recommendation tables (Supabase has reco.sources, reco.recommendation_lists, reco.taste_profiles)
DROP TABLE IF EXISTS recommendation_sources CASCADE;
DROP TABLE IF EXISTS recommendation_snapshots CASCADE;
DROP TABLE IF EXISTS profile_recommendation_lists CASCADE;
DROP TABLE IF EXISTS profile_recommendation_list_items CASCADE;
DROP TABLE IF EXISTS recommendation_write_requests CASCADE;
DROP TABLE IF EXISTS recommendation_event_outbox CASCADE;
DROP TABLE IF EXISTS recommendation_generation_jobs CASCADE;
DROP TABLE IF EXISTS recommendation_list_versions CASCADE;
DROP TABLE IF EXISTS recommendation_active_lists CASCADE;
DROP TABLE IF EXISTS recommendation_write_idempotency CASCADE;
DROP TABLE IF EXISTS service_recommendation_batch_idempotency CASCADE;

-- 6. Drop account-scoped user-data tables (Supabase has public.account_preferences, private.account_secrets, private.personal_access_tokens, etc.)
DROP TABLE IF EXISTS account_api_keys CASCADE;
DROP TABLE IF EXISTS integration_audit_log CASCADE;
DROP TABLE IF EXISTS integration_outbox_events CASCADE;
DROP TABLE IF EXISTS public_account_recommendation_lists CASCADE;
DROP TABLE IF EXISTS public_account_recommendation_list_versions CASCADE;
DROP TABLE IF EXISTS public_account_taste_profiles CASCADE;
DROP TABLE IF EXISTS public_account_taste_profile_versions CASCADE;
DROP TABLE IF EXISTS public_account_write_idempotency_keys CASCADE;
DROP TABLE IF EXISTS public_account_write_audit_events CASCADE;

-- 7. Drop profile eligibility/app signal tables (handled by Supabase RPCs)
DROP TABLE IF EXISTS profile_eligibility_projections CASCADE;
DROP TABLE IF EXISTS eligible_profile_change_feed CASCADE;
DROP TABLE IF EXISTS eligible_profile_change_checkpoints CASCADE;
DROP TABLE IF EXISTS eligible_profile_snapshots CASCADE;
DROP TABLE IF EXISTS eligible_profile_snapshot_items CASCADE;
DROP TABLE IF EXISTS profile_signal_versions CASCADE;
DROP TABLE IF EXISTS app_profile_history_signals CASCADE;
DROP TABLE IF EXISTS app_profile_rating_signals CASCADE;
DROP TABLE IF EXISTS app_profile_watchlist_signals CASCADE;
DROP TABLE IF EXISTS app_profile_continue_watching_signals CASCADE;

-- 8. Drop profile language profiles (profile-level, should be in Supabase preferences)
DROP TABLE IF EXISTS profile_language_profiles CASCADE;

-- 9. Drop profile title metadata state (profile-level, Supabase has media_watch_summary)
DROP TABLE IF EXISTS profile_title_metadata_state CASCADE;

-- 10. Drop profile input signal cache (local cache, no longer needed)
DROP TABLE IF EXISTS profile_input_signal_cache_sections CASCADE;

-- 11. Finally drop core identity/profile tables
DROP TABLE IF EXISTS profile_settings CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS profile_group_members CASCADE;
DROP TABLE IF EXISTS profile_groups CASCADE;
DROP TABLE IF EXISTS personal_access_tokens CASCADE;
DROP TABLE IF EXISTS account_secrets CASCADE;
DROP TABLE IF EXISTS account_settings CASCADE;
DROP TABLE IF EXISTS app_users CASCADE;
