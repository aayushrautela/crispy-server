# Homescreen × Reco Engine Mode Filter

## Context

The main server owns homescreens. Home = recommendations: client apps call
`/home` and read back whatever the pipeline wrote for that profile. Three
sources feed one ingest pipeline:

- `reco` — personalized recommendations from the external reco engine, pushed.
- `custom` — curated lists from an external service, pushed (NOT admin-curated).
- `fallback` — deterministic default templates, **pulled on miss/failure** via an internal HTTP endpoint that returns the same `RecoListWriteRequest` shape as the external sources.

A profile's `homeMode` (`identity.profile_preferences.settings_json.homeMode`)
controls whose pushed snapshot wins in the resolution chain:

1. `custom` (user/custom snapshot) — highest priority
2. `reco` (reco snapshot) — second priority
3. fallback (pulled and written by the pipeline when the above are missing/failed)

See `docs/architecture/recommendation-engine.md` → "Home ingest pipeline" for
the full flow, including the two eager fallback-pull triggers:

- `/home` read with empty store for the profile → pipeline pulls fallback, writes, serves.
- external `reco`/`custom` push attempt fails → pipeline eagerly pulls fallback so the user is not left empty.

The server-side write guards already enforce the conflict rules
(`HomeModeService.assertCanWrite`):

- `user` write requires `homeMode === 'custom'` (else `409 home_mode_conflict`)
- `service` (reco) write is blocked when `homeMode === 'custom'` (else `409`)

Continue-watching is layered on top of the materialized home at read time
(real-time, per-profile, sourced from `playback_progress`); it is not part of
this pipeline.

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
