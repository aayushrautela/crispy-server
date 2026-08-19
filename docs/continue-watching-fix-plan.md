# Continue Watching / History Ingestion Fix Plan

Status: Plan approved — implementation pending ("don't code yet").
Last updated: 2026-08-19

## 1. Goal & principles

- `watch_state` / Continue Watching (CW) / history code stays **provider-agnostic and Jellyfin-like**. No Trakt/SIMKL-specific branching in it.
- Trakt and Simkl are **external ingestors**: their only job is to emit correct, generic `ImportedWatchEventDraft` / `ImportedProviderPlaybackState` records (with a proper `position_seconds`). Deriving `position_seconds` from a provider's `progress%` is the **ingestor's responsibility**.
- Keep the data model faithful to Jellyfin (see §2).

This separation already mostly holds today: `replaceImportedInteractions`, `upsertPlayback`,
`buildProviderImportFacts`, and `listContinueWatchingPage` contain zero provider names — they
operate on generic types. The work below preserves and sharpens that boundary.

## 2. Jellyfin model validation (confirmed)

Jellyfin's per-user state table `UserData` stores only the **position**, not the duration:

- `UserData`: `PlaybackPositionTicks` (resume position), `PlayCount`, `Played`, `IsFavorite`,
  `Rating`, `LastPlayedDate`, `AudioStreamIndex`, `SubtitleStreamIndex`, `Likes`. **No duration column.**
- `BaseItems` (the media item): `RunTimeTicks` (duration). Duration lives on the **item**, not on user state.

Our model is a 1:1 match:

| Concept | Jellyfin | Ours |
|---|---|---|
| Resume position (per user/item) | `UserData.PlaybackPositionTicks` | `watch_state.position_seconds` |
| Total duration (per item) | `BaseItems.RunTimeTicks` | `tmdb_titles.runtime` / `tv_episodes.runtime` |

**Conclusion:** our `watch_state` correctly omits `duration_seconds` (just like Jellyfin). The
ingestor must derive `position_seconds = progress% × (runtime from content metadata)` — the exact
Jellyfin pattern, where clients report a position and the total runtime is looked up from the item.
**No schema change to `watch_state` is required.**

## 3. Confirmed root causes (from live VPS + code analysis)

1. **Missing runtime → position 0.** Trakt (and Simkl) `/sync/playback` returns `progress%` but
   **no `runtime`**. `traktPlaybackSnapshot(item, movie?.runtime=undefined)` → `durationSeconds=null`
   → `positionSeconds=null` → `?? 0`. Every imported resume point gets `position_seconds=0` → never
   matches CW (`position_seconds > 0`). *(Confirmed live: 7 playback items returned `progress` 1.6%–65%
   but no `runtime`, even with `extended=progress`.)*
2. **`ON CONFLICT DO NOTHING` drops resume over played.** `upsertPlayback`
   (`src/modules/integrations/local-provider-history-writer.ts:245`) silently Skips a playback row
   that collides with an already-inserted played-history row for the same item (e.g. Wonder Woman)
   → resume lost.
3. **Episodes.** Per-episode `watch_state` rows are the correct (Jellyfin-like) model and the catalog
   already has **12,512 episode `content_items`**, so resolution generally works. But (a) **episode
   runtime is unavailable** (`tmdb_titles.episode_run_time` is empty `[]`) so even resolved episodes
   get position 0, and (b) episodes missing from catalog are dropped with a warning.
4. **Broken "Next Up" hack.** `deriveContinueWatching` (`src/modules/integrations/trakt/trakt-import.service.ts:121-145`)
   emits an inert "next episode" `playback_progress_snapshot` with `progressBps:0` and no position —
   a Jellyfin *Next Up* attempt that writes misleading position-0 rows and does not surface anywhere.
5. **Local client** (`crispy-rewrite`): `PlayerSessionViewModel.onCleared` (~1278-1279) cancels the
   coroutine that reports the final stop/position → last resume point lost.

## 4. Work items

### A. Ingestor-local runtime derivation — NO history code change
Files:
- `src/modules/integrations/trakt/trakt-import.normalizer.ts`
- `src/modules/integrations/simkl/simkl-import.normalizer.ts`

- Add a runtime resolver inside each ingestor: given the resolved identity (`tmdbId`, and for
  episodes the show), look up duration:
  - **movie** → `tmdb_titles.runtime` (minutes) × 60.
  - **episode** → episode-level runtime if present (`tv_episodes.runtime`, after hydration), else
    **show-average fallback** (`tmdb_titles.episode_run_time[0]`) or a sane default (~45 min).
- Feed that runtime into the existing `traktPlaybackSnapshot(item, runtime)` (and the Simkl
  equivalent) so `positionSeconds = progress% × runtimeSeconds` is computed correctly.
- Optional robustness: pass the episode's **own** tmdb/tvdb id (already present in Trakt's episode
  node) into `buildImportedEpisodeIdentity` so resolution is not solely show+season+episode.
- All derivation stays in the ingestor; `watch_state` writer is untouched.

### B. Generic history correctness (provider-agnostic, Jellyfin-like)
File: `src/modules/integrations/local-provider-history-writer.ts:245`
- Change `ON CONFLICT (profile_id, item_id) DO NOTHING` →
  `DO UPDATE SET position_seconds=EXCLUDED.position_seconds, played=EXCLUDED.played,
  play_count=EXCLUDED.play_count, last_played_at=EXCLUDED.last_played_at`.
  Playback is written after history in `replaceImportedInteractions`, so the resume state wins.
  No provider names touched.
- CW query (`listContinueWatchingPage`, `src/modules/integrations/local-user-watch.service.ts:169`)
  already returns per-item resume rows ordered by recency; the client groups episodes under a series
  (Jellyfin-style). Verify client grouping; no server change expected.

### C. Shows/episodes parity + real Next Up
File: `src/modules/integrations/local-user-watch.service.ts` (new `listNextUpPage`), plus API route/DTO.
- **Resume:** keep per-episode `watch_state` rows (already correct).
- **Next Up (new, generic, provider-agnostic):**
  - Remove the broken `deriveContinueWatching` emission and its `showProgress` tracking
    (`trakt-import.service.ts:121-178` and the `showProgress` accumulator in
    `normalizeTraktWatchedShows`). This deletes the Trakt-specific Next Up hack from the ingestor.
  - Add a server `listNextUpPage` that, Jellyfin-style, computes the **next unwatched episode per
    show** from the profile's watched-episode history joined to `tv_episodes` (ordered by
    season/episode), returning one entry per show sorted by most-recent watch activity.
  - Add the corresponding generic API endpoint + DTO. Client UI support is a separate (client) task.
- **Episode runtime:** hydrate/store episode-level runtime (best-effort) so position derivation works;
  fall back to show average when missing.

### D. Local client (`crispy-rewrite`) — separate from server history
File: `android/app/src/main/java/com/crispy/tv/playerui/PlayerSessionViewModel.kt` (~1278-1279)
- Fix `onCleared`: do not cancel the coroutine that reports the final stop/position; `await` it (or
  use a non-cancellable scope) so the last resume position is persisted.
- `MIN_RESUME_PCT=5` already equals Jellyfin's default (5%/90%) — **leave as-is**.

### E. Tests (code-only validation)
- Unit tests for ingestor runtime derivation (progress% × content runtime → position_seconds) using
  fixtures (no VPS).
- Unit test for `upsertPlayback` `DO UPDATE` semantics (playback wins over stale played row).
- Unit test for new `listNextUpPage` logic.
- Reuse existing `*.test.ts` patterns in `src/modules/integrations/`.

## 5. Execution order

1. **A** — ingestor runtime (Trakt + Simkl)
2. **B** — `DO UPDATE` in `upsertPlayback`
3. **C** — remove `deriveContinueWatching`; add `listNextUpPage` + API
4. **D** — client `onCleared` fix
5. **E** — tests

## 6. Validation

- **Code-only** (per decision): implementation + unit tests only. The user will re-run the Trakt
  import on the VPS to validate end-to-end.
- Re-running the import for `aayush@test18.com` (it `DELETE`s + re-`INSERT`s `watch_state`) should
  then show the 7 `/sync/playback` items with correct `position_seconds`
  (e.g. Afterburn ~65% × 106 min ≈ 69 min), and Next Up should list the next unwatched episode per
  in-progress show.

## 7. Notes / out of scope

- Simkl currently has 0 sessions for this account, but the same fix applies; both ingestors stay
  symmetric and free of history-code references.
- `watch_state` has no `duration_seconds` column by design (matches Jellyfin) — not added.
- Client-side Next Up UI rendering is a separate client task, not covered here.
