# Client App Recommendation Cutover

Status: target change, hard cutoff.

Client recommendation/home responses are moving away from `BaseItemDto`.

## New rule

`GET /v1/profiles/:profileId/home` returns sections of UI-ready client cards:

```ts
type ClientHomeSection = {
  listKey: string;
  title: string;
  subtitle: string | null;
  layout: 'regular' | 'landscape' | 'hero' | 'collection';
  items: ClientMediaCard[];
  meta: Record<string, unknown>;
};
```

Each item is a `ClientMediaCard` with `itemId`, `mediaType`, title, artwork, lightweight metadata, and watch progress. Recommendation home items are not `BaseItemDto`.

## Hard cutoff rules

- No legacy recommendation item wrappers.
- No dual client response shape.
- No `BaseItemDto` in public recommendation home sections.
- No provider IDs in normal client recommendation cards.
- Every recommendation item, including collection items, must have `itemId`.
- List `title` is required and `subtitle` is present as `null` when absent.

## References

- Target spec: `docs/specs/client-reco-pipeline-spec.md`
- Implementation plan: `docs/specs/client-reco-pipeline-implementation-plan.md`
