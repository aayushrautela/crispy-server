-- Drop the retired recommendation signal-bundle cache infrastructure.
--
-- Previously MAIN exposed a single /internal/apps/v1/.../signals/recommendation-bundle
-- endpoint backed by:
--   1. ProfileInputSignalFacade            (de-duplicating facade with TTLs)
--   2. ProfileInputSignalCacheService       (per-family cache service backed by
--      profile_input_signal_cache_sections)
--   3. DefaultProfileSignalBundleService    ( eligib /auth + facade wrapper)
-- All three services were deleted in favor of per-signal read routes at
-- /internal/apps/v1/.../signals/watch/{history,ratings,watchlist,
-- continue-watching,episodic-follow} and .../signals/taste. RECO now calls
-- those per-signal routes directly (same shape as the user-facing /v1 watch
-- routes), so the cache had zero consumers and has been retired.
--
-- Safe to drop: zero query sites on profile_input_signal_cache_sections
-- remain in src (verified by scripts/guard-retired-modules.ts).

DROP TABLE IF EXISTS profile_input_signal_cache_sections;
