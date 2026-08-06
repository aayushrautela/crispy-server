-- Drop recommendation_snapshots: legacy table with no write callers.
--
-- The reco engine migrated to home-write.service.ts (writing to home_lists)
-- and no runtime code writes to recommendation_snapshots anymore. The table
-- only contains stale diagnostic data from before the migration. Safe to drop.

DROP TABLE IF EXISTS recommendation_snapshots;
