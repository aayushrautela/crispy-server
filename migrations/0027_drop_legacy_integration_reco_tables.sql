-- Drop the legacy integration-recommendations write/ingest subsystem.
--
-- Historically there were three parallel home-feed write paths:
--   1. HomeWriteService.writeHome            (unified ingest pipeline,
--      writes recommendation_active_lists + recommendation_list_versions
--      atomically per (account, profile, source); this is the only path the
--      client app reads via HomeResolverService -> HomeListsRepo.
--   2. IntegrationRecommendationService.putList (per-rail, separate schema
--      below; the route surface /api/integrations/v1 was retired and is
--      enforced by scripts/guard-retired-modules.ts).
--   3. RecommendationSnapshotsRepository       (admin-UI diagnostic of last
--      reco-engine computation; orthogonal to the feed, retained).
--
-- Path 2 has zero callers in runtime code and was already retired at the HTTP
-- layer. Its tables are now orphaned and safe to drop. recommendation_snapshots
-- and the unified home-feed tables are intentionally untouched.

DROP TABLE IF EXISTS profile_recommendation_list_items;
DROP TABLE IF EXISTS profile_recommendation_lists;
DROP TABLE IF EXISTS recommendation_write_requests;
