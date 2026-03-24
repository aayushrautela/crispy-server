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

   Example auth config when Supabase is the auth provider:
   ```env
   AUTH_JWKS_URL=https://your-project.supabase.co/auth/v1/.well-known/jwks.json
   AUTH_JWT_ISSUER=https://your-project.supabase.co/auth/v1
   AUTH_JWT_AUDIENCE=authenticated
   AUTH_ADMIN_URL=https://your-project.supabase.co/auth/v1
   AUTH_ADMIN_TOKEN=replace_with_auth_admin_token
   ```

   The API requires `SERVICE_CLIENTS_JSON` for service-to-service authentication. Internal callers such as the hosted recommendation engine must send `x-service-id` and `x-api-key`, and those values must match an active entry in `SERVICE_CLIENTS_JSON`.

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
