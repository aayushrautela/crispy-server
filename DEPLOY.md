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
