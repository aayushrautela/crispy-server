# Crispy Integration API Guide

`/api/integrations/v1` is retired and is not a supported interface for privileged recommendation applications.

Recommendation engines and other privileged app principals must use:

- `/internal/apps/v1` for app-principal self, eligibility, profile change feeds, signal bundles, recommendation writes, recommendation run/batch/backfill tracking, and audit reads.
- `/internal/confidential/v1` for confidential profile config bundles and final `aiConfig` policy.

Do not add compatibility adapters from `/api/integrations/v1` to the internal privileged app APIs. Existing recommendation clients must remove all calls to `/api/integrations/v1`.

For the current recommendation-worker contract and endpoint examples, see `RECOMMENDATION_WORKER_CONTRACT.md` and the internal route map in `README.md`.
