-- Collapse fallback + outbox into the unified ingest pipeline.
--
-- Background: fallback home data historically landed in two parallel tables:
--   1. recommendation_list_versions  (via the unified ingest pipeline; items
--      carry resolved itemId)
--   2. home.fallback_list_versions    (via a bypass path inside the resolver;
--      items carried raw providerRefs and broke the hydrator's shape contract)
--
-- The bypass is being removed; fallback now flows through the unified ingester
-- only. home.fallback_list_versions is a pure cache with no source-of-truth
-- content, so dropping it is safe -- the next seed run repopulates the unified
-- table.
--
-- Same rationale for service_outbox_events and admin_bulk_jobs*: the reco
-- engine is now notified via a fire-and-forget HTTP POST from
-- RecommenderNotifier. Crispy no longer tracks recompute jobs, retry state,
-- or dispatch locks in the database. The admin_bulk_jobs tables (added in
-- migration 0020) are empty in production; service_outbox_events has 12
-- pending rows that were never delivered and are intentionally discarded.

DROP TABLE IF EXISTS home.fallback_list_versions;
DROP TABLE IF EXISTS service_outbox_events;
DROP TABLE IF EXISTS admin_bulk_job_events;
DROP TABLE IF EXISTS admin_bulk_job_requests;
DROP TABLE IF EXISTS admin_bulk_job_targets;
DROP TABLE IF EXISTS admin_bulk_jobs;
