# Fedora VPS deploy

1. Install tools:
   ```bash
   sudo dnf install -y git docker docker-compose-plugin
   sudo systemctl enable --now docker
   sudo usermod -aG docker $USER
   ```

2. Clone and configure:
   ```bash
   git clone <your-repo-url> /opt/crispy-server
   cd /opt/crispy-server
   cp .env.production.example .env
   ```

3. Fill `.env`.

   Auth is external-only. Application data lives in the local Postgres from `DATABASE_URL`, while JWT verification and optional upstream user deletion use the `AUTH_*` variables.

   Product defaults live in `config/app-config.json.example` (committed template). The loader looks for `config/app-config.json` first; if absent, it falls back to the example template. To customize, copy the template:
   ```bash
   cp config/app-config.json.example config/app-config.json
   ```
   The actual `config/app-config.json` is gitignored so it won't conflict on pulls. Keep `.env` focused on secrets and deployment-specific wiring.

   AI credential fallback is configured in two places:

   - per-account secret value: `GET/PUT/DELETE /v1/account/secrets/ai-api-key`
   - optional server fallback credentials: `AI_SERVER_KEYS_JSON`, for example `[{"providerId":"openai","apiKey":"sk-..."}]`

   If `AI_SERVER_KEYS_JSON` is empty, AI requests fall back from the account's own key straight to the shared pool of other stored account keys for the selected provider.

   Ownership contract for hosted and internal consumers:

   - The signed-in account is the only auth actor and the ownership root.
   - Profiles are child personas under that account, not separate users.
   - Shared management data stays account-scoped: addons, AI API key, metadata-enrichment availability flags, PATs, account deletion, and profile roster management.
   - Personal experience data stays profile-scoped: profile settings, Trakt and Simkl connections, imports, watch history, continue watching, watchlist, ratings, tracked series, taste profiles, and recommendations.
   - Privileged routes are account-rooted: resolve the owning account first, then target a profile under that account for personal data.

    Example auth config when Supabase is the auth provider:
    ```env
    SUPABASE_URL=https://your-project.supabase.co
    AUTH_JWT_AUDIENCE=authenticated
    SUPABASE_SECRET_KEY=replace_with_supabase_secret_key
    ```

   The API requires `SERVICE_CLIENTS_JSON` for service-to-service authentication. Internal callers such as the recommendation worker must send `x-service-id` and `x-api-key`, and those values must match an active entry in `SERVICE_CLIENTS_JSON`.

   When integrating a recommendation worker or other privileged service, model ownership as:

   - account/email identifies the owning user in your control plane
   - profile identifies the personal experience being targeted inside that account
   - account-shared secret routes are account-owned even when a current helper route accepts `:profileId`

   Example:
   ```env
   SERVICE_CLIENTS_JSON=[{"serviceId":"crispy-recommendation-engine","apiKey":"replace_with_long_random_secret","scopes":["profiles:read","watch:read","taste-profile:read","taste-profile:write","recommendations:read","recommendations:write","recommendation-work:claim","recommendation-work:renew","recommendation-work:complete","profile-secrets:read","provider-connections:read","provider-tokens:read","provider-tokens:refresh","admin:diagnostics:read"],"status":"active"}]
   ```

   The external engine should then use:
   ```env
   HOSTED_API_BASE_URL=https://your-api-domain.com
   HOSTED_SERVICE_ID=crispy-recommendation-engine
   HOSTED_API_KEY=replace_with_long_random_secret
   ```

   Privileged data reads and writes should use the account-rooted internal routes described in `README.md`. Treat `profileId` as the selected persona inside the owning account, not as a separate-user model.

4. Start it:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   docker compose -f docker-compose.prod.yml exec api npm run migrate:prod
   ```

5. Reverse proxy to:
   - `127.0.0.1:18765`

6. Test on the server:
   ```bash
   curl http://127.0.0.1:18765/healthz
   ```

7. Update later:
   ```bash
   git pull --ff-only
   docker compose -f docker-compose.prod.yml up -d --build
   docker compose -f docker-compose.prod.yml exec api npm run migrate:prod
   ```

Notes:
- DB survives restarts because Postgres uses the `postgres-data` Docker volume.
- Do not run `docker compose down -v`.
