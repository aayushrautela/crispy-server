# Homescreen × Reco Engine Mode Filter

## Context

The main server owns homescreens. Home = recommendations: client apps call
`/home` and read back whatever the pipeline wrote for that profile. Two stored
sources feed one ingest pipeline; one shared artifact completes the picture:

- `reco` — personalized recommendations from the external reco engine, pushed.
- `custom` — curated lists from an external service, pushed (NOT admin-curated).
- `default` — a **shared** deterministic home built in-process from
  server-managed templates (`home.default_list_templates` + list sources),
  cached in Redis as one English snapshot and served to any profile with no stored home. It
  is never written to per-profile rows.

A profile's `homeMode` (`identity.profile_preferences.settings_json.homeMode`)
controls how the profile's home is resolved. **A response is either the
`custom`-only snapshot or a blend of reco rails layered on top of the shared
default home** — sources are not concatenated arbitrarily, but reco and the
shared default *are* combined.

1. `custom` mode: serve `custom` rows if non-empty; **otherwise empty** — `custom`
   mode does not layer `reco` or `default`. Switching `custom → reco` requires
   a one-shot clear of the custom snapshot for that profile (performed by the
   reco pipeline, not the ingester) so subsequent reads fall through to `reco`
   (and then `default`) instead of the stale `custom` rows.
2. `reco` mode (default): serve `reco` rows if non-empty **on top of** the
   generic default-home rails **marked `show_with_reco`** (flagged per rail in
   the admin UI). Reco personalizes only the rails it sends (hero and a few
   picks); the marked generic rails supply the evergreen sections below. The
   marked subset is built lazily on first miss, cached as one English snapshot
   (versioned key, TTL-expired), reused by every profile — a brand new profile
   gets a populated home on first read with zero per-profile work, and generic
   rails are never copied into per-user rows. Profiles with no reco rows get the
   full shared default alone; unmarked rails are default-only. If the shared
   build itself fails (e.g. MDBList/TMDB outage when a rail's source is
   unreachable) or resolves to zero
   rails, the response is `source: 'empty'`. Kids profiles are excluded from the
   shared default in v1; with no reco rows they report `empty`. There is no
   cross-source dedup.

See `docs/architecture/recommendation-engine.md` → "Home ingest pipeline" for
the shared-default contract and the resolution rules.

Continue-watching is layered on top of the materialized home at read time
(real-time, per-profile, sourced from `playback_progress`); it is not part
of this pipeline.

## Deferred work: engine-side skip-enqueue

When the engine is healthy and a profile is in `custom` mode, the engine should
not enqueue recompute work for that profile at all (it would be wasted work and
would fail the `assertCanWrite` guard downstream). This filtering must happen
**before** the engine sends the output to the main server.

### Proposed engine-side rule

In the engine's profile-selection / enqueue step:

- Resolve each candidate profile's effective `homeMode`.
- If `homeMode === 'custom'`, skip the profile (do not generate candidates,
  do not call `recommendations:write`, do not emit an outbox item).
- If `homeMode === 'recommended'` (default) or unset, proceed as today.

### How the engine gets `homeMode`

The engine reads profile metadata from the main server. The canonical source is
`GET /v1/profiles/:profileId/home-mode` (public-app, `profile-settings.ts`), or
the field can be included in the bulk profile/metadata payload the engine
already consumes. No new endpoint is required — reuse the existing `home-mode`
read.

### Why server-side guard is still required

The engine-side skip is an optimization, not a security boundary. The main
server's `assertCanWrite` guard remains the authoritative enforcement so that:

- A stale/out-of-order engine write cannot overwrite a `custom` home.
- A profile switched to `custom` mid-flight is still protected.

## Acceptance criteria (when implemented)

- [ ] Engine skips recompute enqueue for `custom` profiles.
- [ ] No change in behavior for `recommended`/unset profiles.
- [ ] Server-side `assertCanWrite` guard remains the single source of truth for 409s.
- [ ] A test asserts the engine does not emit a write for a `custom` profile.
