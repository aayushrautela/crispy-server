-- 0030_drop_profile_signal_bundle_audit_action.sql
-- The `profile_signal_bundle_read` audit action belongs to the retired
-- recommendation-bundle ingest path (see scripts/guard-retired-modules.ts).
-- No code path emits this action anymore and the TypeScript union + Fastify
-- schema enum no longer accept it. Delete any leftover rows so audit reads
-- don't fail response validation, then nothing else remains to do — the
-- `action` column is a free-form `text` with no DB-level enum to alter.

DELETE FROM app_audit_events
WHERE action = 'profile_signal_bundle_read';
