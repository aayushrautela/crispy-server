# Fedora VPS deploy (self-hosted Supabase)

1. Install tools:
   ```bash
   sudo dnf install -y git docker docker-compose-plugin
   sudo systemctl enable --now docker
   sudo usermod -aG docker $USER
   ```

2. Deploy self-hosted Supabase (if not already):
   ```bash
   git clone https://github.com/supabase/supabase.git /opt/supabase
   cd /opt/supabase/docker
   cp .env.example .env
   # Edit .env: set POSTGRES_PASSWORD, JWT_SECRET, SERVICE_ROLE_KEY, ANON_KEY, SUPABASE_PUBLIC_URL, API_EXTERNAL_URL, etc.
   # Generate keys: sh utils/generate-keys.sh
   docker compose up -d
   ```

3. Clone and configure crispy-server:
   ```bash
   git clone <your-repo-url> /opt/crispy-server
   cd /opt/crispy-server
   cp .env.production.example .env
   ```

4. Fill `.env` with self-hosted Supabase values.

   **Key env vars for self-hosted Supabase:**
   ```env
   # Database - connects to Supabase Postgres via shared Docker network
   POSTGRES_PASSWORD=<from Supabase .env POSTGRES_PASSWORD>
   DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@supabase-db:5432/postgres

   # Redis - separate container on host
   REDIS_URL=redis://host.docker.internal:6379

   # Auth - connects to Supabase Kong gateway on host
   AUTH_BASE_URL=http://host.docker.internal:8000
   AUTH_ADMIN_API_KEY=<from Supabase .env SERVICE_ROLE_KEY>
   AUTH_JWT_AUDIENCE=authenticated
   AUTH_JWT_ISSUER=http://host.docker.internal:8000/auth/v1

   # App
   APP_PUBLIC_URL=https://api.crispytv.tech
   APP_DISPLAY_NAME=CrispyTV
   ACCOUNT_PORTAL_URL=https://crispy-account-portal.vercel.app
   ```

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

   Recommendation generation is handled by an external event-driven recommendation engine. Crispy Server emits durable recompute events through its outbox; the engine receives those events, authenticates to Crispy API as a service principal, pulls authorized source data from the internal API, and publishes recommendation outputs through the agreed internal API surface. Crispy Server remains the source of truth for account/profile authorization, canonical TMDB-backed media identity, API contracts, target user interaction signals, and stored recommendation snapshots. Supabase is not used as an app-data store and the recommendation engine does not read Supabase directly by default.

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

5. Start Redis on host (if not already):
   ```bash
   docker run -d --name redis -p 6379:6379 --restart unless-stopped redis:7
   ```

6. Start crispy-server:
   ```bash
   cd /opt/crispy-server
   docker compose up -d --build
   docker compose exec api npm run migrate:prod
   ```

7. Reverse proxy to:
   - `127.0.0.1:18765`

8. Test on the server:
   ```bash
   curl http://127.0.0.1:18765/healthz
   ```

9. Update later:
   ```bash
   git pull --ff-only
   docker compose up -d --build
   docker compose exec api npm run migrate:prod
   ```

Notes:
- Supabase Postgres data survives restarts via its own `volumes/db/data` Docker volume.
- Crispy-server does not run its own Postgres/Redis — it connects to the host's Supabase stack and Redis container.
- Do not run `docker compose down -v` on Supabase stack.
- Crispy-server compose uses `supabase_default` external network to reach `supabase-db:5432` and `host.docker.internal` to reach host Kong (8000) and Redis (6379).
