# Public Media API Spec

Status: superseded for recommendation surfaces.

This document previously defined a BaseItemDto-first public recommendation direction. That direction is no longer the target for recommendation/home APIs.

Current recommendation target:

- `docs/specs/client-reco-pipeline-spec.md`
- `docs/specs/client-reco-pipeline-implementation-plan.md`

Rules for recommendation work:

- Public home recommendations return client UI cards, not `BaseItemDto`.
- RECO signal bundles return machine DTOs, not `BaseItemDto`.
- RECO writes list metadata plus ordered item refs.
- No compatibility wrapper, dual response shape, or migration-window alias should be introduced.

`BaseItemDto` may still exist in non-recommendation media/watch contracts until those surfaces are separately redesigned, but it is not the recommendation pipeline target.
