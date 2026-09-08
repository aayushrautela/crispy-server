# TV Login — QR Code / Device Authorization Flow

Reference for the RFC 8628 device sign-in flow implemented in crispy-server, plus the client-side work needed to complete it (TV client, web approval page, mobile app links).

## What's implemented (server side)

OAuth 2.0 Device Authorization Grant — **[RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628)** — the same flow Netflix, YouTube, Spotify, and Disney+ use for TV sign-in. Docs: [Google's guide for TV & limited-input devices](https://developers.google.com/identity/protocols/oauth2/limited-input-device), [Pragmatic Web Security overview](https://pragmaticwebsecurity.com/articles/oauthoidc/device-flow.html), [Curity explainer](https://curity.io/resources/learn/oauth-device-flow/).

### Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /v1/auth/device/authorize` | public | TV requests codes. Body: `{ clientId: "crispy-tv", deviceName?: string, deviceId?: uuid }` |
| `POST /v1/auth/device/token` | public | TV polls for result. Body: `{ deviceCode }` |
| `POST /v1/auth/device/verification` | user Bearer | Look up a user code, get device details |
| `POST /v1/auth/device/verification/approve` | user Bearer | Approve the device |
| `POST /v1/auth/device/verification/deny` | user Bearer | Deny the device |
| `GET /v1/auth/devices` | user Bearer | List connected devices (with active token previews) |
| `DELETE /v1/auth/devices/{deviceId}` | user Bearer | Revoke a device and all its sessions (204) |

All responses use the standard `{ data, meta: { requestId } }` envelope.

### Codes & constants

- `userCode`: 8 chars from base-20 charset `BCDFGHJKLMNPQRSTVWXZ` (RFC §6.1 recommendation: no vowels, no digits — easy to type, never forms words), displayed as `XXXX-XXXX`
- `deviceCode`: `cp_dvc_` + 32 random bytes (base64url), **stored hashed, single-use**
- `deviceId`: optional UUID the TV echoes from a previous login. Stored as an **untrusted** `claimed_device_id`; validated (UUID format, same account, not revoked) only at approval time
- TTL: 15 minutes, poll interval: 5 seconds
- Approved device gets a standard `cp_pat_` session token, 90-day expiry, named `TV session: <deviceName>`, linked to a row in `private.devices`
- Verification URL: `DEVICE_VERIFICATION_URL` env (defaults to `APP_PUBLIC_URL/device`)
- Brute-force mitigation (RFC §5.1): 5 failed user-code lookups / 15 min per user (429 `user_code_rate_limited`); 10 authorizations / 5 min per IP (429 `device_authorization_rate_limited`)

### Device identity (stable across re-logins)

Device rows in `private.devices` are created at **approval** time (when the account is known):

- On approve: if the TV's `claimed_device_id` resolves to an unrevoked device owned by the approving account, that row is refreshed (name + `last_seen_at`) and reused — otherwise a new row is created.
- On poll `approved`: the session PAT is linked to the device (`personal_access_tokens.device_id`), `last_seen_at` is touched, and the response includes `deviceId` so the TV can echo it on future logins.
- Denying never touches devices. Revoking via `DELETE /v1/auth/devices/{id}` revokes the device row **and** all its active PATs in one transaction.

## UX Flow

```
TV                          Phone (or any browser)           Server
|-- POST /device/authorize  |                                |
|<-- userCode, deviceCode,  |                                |
|    verificationUriComplete|                                |
|-- render QR(userCode) +   |                                |
|   "visit crispy.tv/device"|                                |
|-- poll /device/token -->  |                                |
|   every 5s                |-- scan QR / type code          |
|<-- authorization_pending -|-- GET /device?user_code=XXXX   |
|                           |   (universal link: opens app   |
|                           |    if installed, else web page)|
|                           |-- POST /verification           |
|                           |<-- "Approve Living Room TV?"   |
|                           |-- POST /verification/approve   |
|<-- approved + cp_pat_ token                                |
|-- signed in, start        |                                |
```

### Poll outcomes (`POST /v1/auth/device/token`)

| Response `data.status` | TV client behavior |
|---|---|
| `authorization_pending` | keep polling on the same interval |
| `slow_down` (includes `interval`) | increase interval by 5s and continue |
| `approved` (includes `plaintextToken`, `deviceId`, `token`, `user`) | store token + deviceId (echo it in future `/authorize` calls), done |
| `access_denied` | user denied — show message, restart flow |
| `expired_token` | code expired/used — restart flow from `/authorize` |

Note: unlike strict RFC error codes, this server returns these statuses in the normal response envelope with HTTP 200.

## Still to build

### 1. TV client
- `POST /v1/auth/device/authorize` on "Sign in" screen
- Render: user code (large), short URL, QR of `verificationUriComplete` (any QR lib, e.g. `qrcode` / `zxing`)
- Poll `/device/token` honoring `interval` / `slow_down`
- On `approved`: persist token, use `Authorization: Bearer cp_pat_...` on all API calls

### 2. Web approval page (required)
Hosted at `DEVICE_VERIFICATION_URL` (e.g. `app.crispytv.tech/device`):
- With `?user_code=XXXX-XXXX` (QR scan): prefill code → call `/verification` → show "Sign in to **Living Room TV**?" → Approve/Deny buttons → call `/approve` or `/deny`
- Without param: code input first, then same confirm step
- If the visitor isn't logged in on web: show your normal web login, then return to the approval step
- On success: "Your TV is signed in"

### 3. Mobile app: open app when available (Netflix-style)
Netflix's TV sign-in works by encoding a plain `https://` URL in the QR. The OS opens the **app** if installed (universal/app links), otherwise the **web page** — one URL, two destinations. Reference: [Apple Universal Links](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content), [Android App Links](https://developer.android.com/training/app-links/verify-site-associations). Do **not** use a `window.location = 'app://'` JS redirect or a raw custom scheme (`crispytv://`) — dead-ends when the app isn't installed (the deprecated `nflx://` problem).

- **iOS:** Associated Domain `app.crispytv.tech` entitlement + host `/.well-known/apple-app-site-association` (AASA) with a `/device` path rule. Handle the link in the app (SwiftUI `.onOpenURL` / `NSUserActivity`).
- **Android:** `/.well-known/assetlinks.json` + intent filter with `autoVerify` for `https://app.crispytv.tech/device`. Read `user_code` from `intent.data`.
- **In-app approval screen:** read `user_code` → `POST /verification` (with app's existing Bearer token) → confirm dialog ("Approve Living Room TV?") → `POST /verification/approve` or `/deny`. User is already logged in — no re-auth.
- **Web page stays as fallback** — it renders only when the app isn't installed or the user chose browser.
- Server needs **zero changes** for any of this; `DEVICE_VERIFICATION_URL` already points at the https URL.

## Security notes (from RFC 8628 §5 + real-world implementations)

- `device_code` is stored only as a SHA-256 hash and is strictly single-use (consumed atomically on token exchange)
- Never auto-approve from the scanned link — the user must always see the device name and explicitly confirm (remote-phishing mitigation, RFC §3.3.1 / §5.4)
- The user code is low-entropy by design; brute-force protection lives server-side (rate limits above), not in code length
- QR encodes `verification_uri_complete` for convenience only; the typed-code path and user-code confirmation display remain mandatory

## File map (server)

- `src/modules/auth/device-authorization.service.ts` — flow logic, code generation, rate limits, device resolution
- `src/modules/auth/device-authorization.repo.ts` — DB access, status machine `pending → approved|denied → consumed`
- `src/modules/auth/devices.repo.ts` — device rows: create/refresh/revoke/list (with active token preview)
- `src/http/routes/auth-device.ts` + `src/http/contracts/auth-device.ts` — routes & schemas
- `migrations/0068_device_authorization_codes.sql` — table + drop of legacy `app_login_handoff_codes`
- `migrations/0069_devices.sql` — `private.devices` table + token/device linkage columns
- OpenAPI: `openapi/public-app.v1.yaml` (tags: Tokens)
