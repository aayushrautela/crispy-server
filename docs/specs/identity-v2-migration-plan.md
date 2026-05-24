# Identity v2 Migration Summary

Status: complete.

Crispy has moved public content identity to opaque item IDs.

## Completed outcome

- Public DTO identity uses 32-character lowercase dashless UUID item IDs.
- Parent fields (`SeriesId`, `SeasonId`) use item IDs where those fields exist.
- Watch, playback, ratings, watchlist, metadata cards, AI insights, and recommendation-facing outputs use item IDs.
- User-state/cache/follow/recommendation tables use UUID item columns.
- External provider references live in `content_provider_refs`.
- Parent links live in `content_item_relationships`.
- Clients do not parse IDs.

## Database result

Migration `0070_identity_v2_item_ids.sql` created and backfilled item identity columns, added constraints, rebuilt keys where needed, and removed old provider-shaped public identity columns from migrated user-state/cache tables.

Critical DB expectations:

- `user_state.watch_events`: `item_id`, `title_item_id`
- `user_state.playback_progress`: `title_item_id`, `playable_item_id`
- `user_state.media_watch_summary`: `item_id`, `title_item_id`
- `user_state.profile_list_items`: `item_id`
- `user_state.profile_ratings`: `item_id`
- `public.watch_media_card_cache`: `item_id`
- `recommendation.recommendation_list_items`: `item_id`
- `read_model.profile_episodic_follow_state`: `next_episode_item_id`
- `public.profile_episodic_follow_state`: `next_episode_item_id`

## Runtime result

- API route params and bodies use `itemId` for public content identity.
- OpenAPI schemas use `PublicItemId` for public content identity.
- Watch/read mappers emit item IDs only.
- Metadata enrichment and card cache lookup by item ID.
- Admin/read services query item UUID columns.
- AI insights accepts `itemId` and decodes it to the internal UUID.
- Target recommendation signal bundles use dedicated RECO item refs with `itemId` plus provider refs, not `BaseItemDto`.

## Verification

- Targeted Identity v2 watch tests pass.
- Typecheck passes.
- Contract docs and public/internal OpenAPI specs are aligned to item IDs.
