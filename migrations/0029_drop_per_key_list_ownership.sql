-- Drop the per-list-key ownership model. Home writes are authorized per
-- source (the app must own the source it writes to); list keys are opaque
-- strings stored verbatim. The allowed_list_keys column is no longer read
-- by the app auth gate, principal builder, or source-ownership repo.
--
-- Idempotent: re-running is a no-op.

ALTER TABLE app_source_ownership DROP COLUMN IF EXISTS allowed_list_keys;
