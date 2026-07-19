-- Remove continue-watching from the fallback-templates table.
--
-- Continue-watching is a per-profile, real-time rail (sourced from
-- playback_progress) that never belonged in the global fallback template table.
-- The resolver now layers it directly via LocalUserWatchService without going
-- through the list-source registry; the seeded row here was redundant and its
-- admin Sync button was broken (no profile context).
--
-- Also drops any orphaned cache rows for the same list_key.
DELETE FROM home.fallback_list_templates WHERE list_key = 'continue-watching';
DELETE FROM home.fallback_list_versions  WHERE list_key = 'continue-watching';
