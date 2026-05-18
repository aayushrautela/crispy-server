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

   Auth is external through Supabase. Fastify remains the API/data boundary, and local Postgres stores product data, operational data, metadata caches, and recommendation data. JWT verification and optional upstream user deletion use the `AUTH_*`/Supabase variables.

   Product defaults live in `config/app-config.json.example` (committed template). The loader looks for `config/app-config.json` first; if absent, it falls back to the example template. To customize, copy the template:
   ```bash
   cp config/app-config.json.example config/app-config.json
   ```
   The actual `config/app-config.json` is gitignored so it won't conflict on pulls. Keep `.env` focused on secrets and deployment-specific wiring.

   AI credentials are configured in two places:

   - per-account BYOK OpenRouter secret value: `GET/PUT/DELETE /v1/account/secrets/ai-api-key`
   - optional single server-funded credential: `AI_SERVER_API_KEY`

   Pro and Ultra tier AI features use `AI_SERVER_API_KEY`; Lite tier users must provide their own OpenRouter key.

   Ownership contract for hosted and internal consumers:

   - The signed-in account is the only auth actor and the ownership root.
   - Profiles are child personas under that account, not separate users.
   - Shared management data stays account-scoped: addons, AI API key, metadata-enrichment availability flags, PATs, account deletion, and profile roster management.
   - Personal experience data stays profile-scoped: profile settings, Trakt and Simkl connections, imports, watch history, continue watching, watchlist, ratings, episodic follow state, taste profiles, and recommendations.
   - Privileged routes are account-rooted: resolve the owning account first, then target a profile under that account for personal data.

    Example auth config when Supabase is the auth provider:
    ```env
    APP_PUBLIC_URL=https://api.crispytv.tech
    APP_DISPLAY_NAME=CrispyTV
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_PUBLISHABLE_KEY=replace_with_supabase_publishable_key
    AUTH_JWT_AUDIENCE=authenticated
    SUPABASE_SECRET_KEY=replace_with_supabase_secret_key_optional
    ```

   Recommendation generation is handled by an external event-driven recommendation engine. Crispy Server emits durable recompute events through its outbox; the engine receives those events, authenticates to Crispy API as a service principal, pulls authorized source data from the internal API, and publishes recommendation outputs through the agreed internal API surface. Crispy Server remains the source of truth for account/profile authorization, canonical TMDB-backed media identity, API contracts, and stored recommendation snapshots. Supabase may store target user interaction signals behind Fastify; the recommendation engine does not read Supabase directly by default.

   Do not deploy a separate recommendation worker from this repository. The `worker` container/process in this repo is the internal BullMQ worker for backend queue jobs; scaling it affects internal async work only and does not scale recommendation generation.

   When integrating a privileged internal caller, model ownership as:

   - account/email identifies the owning user in your control plane
   - profile identifies the personal experience being targeted inside that account
   - account-shared secret routes are account-owned even when a current helper route accepts `:profileId`

   Example inbound service auth config for the external recommendation engine:
   ```env
   RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH=<sha256 hash of the recommender-to-main raw bearer token>
   ```

   Example outbox dispatcher config for main-to-recommender event delivery:
   ```env
   RECOMMENDER_INTERNAL_BASE_URL=https://recommender.example.com
   MAIN_TO_RECOMMENDER_SERVICE_TOKEN=<raw main-to-recommender bearer token>
   OUTBOX_DISPATCHER_ENABLED=true
   ```

   The external recommendation engine reads required data from `/internal/apps/v1`. For AI-assisted generation, the engine calls `POST /internal/recommendations/v1/accounts/:accountId/profiles/:profileId/ai-plan` with business inputs and a bounded candidate pool. Crispy validates eligibility, builds the prompt, selects provider/model/credentials, calls the AI vendor, parses the response, and returns a typed plan. The engine never receives raw OpenRouter, OpenAI-compatible, server-funded, or account BYOK API keys, provider/model routing config, proxy URLs, or raw vendor request details. The engine writes service-owned recommendation outputs through the internal app API. MAIN dispatches recompute events to the engine through the outbox and does not poll it for generation status.

   Privileged inbound data reads and writes should use the account-rooted internal routes documented in OpenAPI (`openapi/internal-services.v1.yaml`) and indexed from `docs/api/README.md`. Treat `profileId` as the selected persona inside the owning account, not as a separate-user model.

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
