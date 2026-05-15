# API contracts and documentation

Crispy Server publishes OpenAPI contracts by audience. OpenAPI is the canonical machine-readable source of truth for paths, methods, parameters, schemas, status codes, security schemes, and examples.

## Source-of-truth ownership

| Document/artifact | Owns | Does not own |
| --- | --- | --- |
| `openapi/*.yaml` | Exact HTTP contracts by API audience | Narrative architecture decisions |
| `docs/api/README.md` | API index, contract workflow, quality gates | Endpoint inventories or duplicated schemas |
| `docs/api/recommendations.md` | Human-facing recommendation API behavior and operational guidance | Exact request/response schemas |
| `docs/api/media-state.md` | Client media identity and watch-state rules | Full endpoint payload maps |
| `docs/supabase-fastify-rls-target-architecture-plan.md` | Current Supabase/Fastify/RLS storage-boundary and watch-domain rules | Exact HTTP contracts or endpoint schemas |
| `openapi/generated/` and `docs/api/generated/` | Generated, tracked tooling artifacts | Hand-authored contract changes |

Do not add a hand-maintained route inventory. Use OpenAPI plus `npm run contract:drift` to detect implemented/documented route drift.

## API classification

| Class | Prefixes | Spec | Consumers | Security |
| --- | --- | --- | --- | --- |
| Public App API | `/v1/**` | `openapi/public-app.v1.yaml` | first-party app clients | user bearer/session auth |
| Public Account API | `/api/account/v1/**` | `openapi/public-account.v1.yaml` | user-owned integrations and PAT clients | PAT bearer or user auth |
| Internal Service API | `/internal/apps/v1/**`, `/internal/recommendations/v1/**` | `openapi/internal-services.v1.yaml` | trusted backend services | service bearer token plus app scopes |
| Recommender Inbound API | `/internal/recommender/v1/**` | `openapi/internal-recommender.v1.yaml` | MAIN service-outbox dispatcher calling RECO | service bearer token |
| Confidential Internal API | `/internal/confidential/v1/**` | `openapi/internal-confidential.v1.yaml` | highly trusted server components | service identity, allowlists, audit |
| Admin/Ops API | `/admin/api/**` | `openapi/admin-ops.v1.yaml` | admin console/operators | admin session or service bearer where allowed |
| Health/Infrastructure | probes such as `/healthz` | `openapi/health-infrastructure.yaml` | load balancers/orchestrators | deployment/network policy |

Browser-only admin UI routes such as `/admin`, `/admin/login`, and `/admin/logout` are intentionally excluded from API specs. Keep those exclusions in `scripts/check-contract-drift.mjs` if the browser-only surface changes.

## Contract checks

| Command | Purpose |
| --- | --- |
| `npm run contract:lint` | Parses all classified specs, validates OpenAPI 3.1 usage, required metadata, operation ids, tags, summaries, success responses, security/public markers, path params, component schemas, and internal examples. |
| `npm run contract:types` | Generates TypeScript types for every classified spec under `openapi/generated/`. |
| `npm run contract:drift` | Compares contract-worthy Fastify routes with documented OpenAPI paths/methods, normalizing `:param` to `{param}` and excluding UI/static routes. |
| `npm run docs:api` | Generates the static API docs manifest under `docs/api/generated/`. |
| `npm run contract:test` | Runs contract lint and type generation. |
| `npm run contract:check` | CI-friendly quality gate for lint, types, route drift, and docs artifact generation. |

The drift checker uses a static spec-to-route-file mapping. When adding or moving route files, update `scripts/check-contract-drift.mjs` as part of the API change.

## Adding or changing endpoints

1. Implement the route without moving existing endpoint paths unless the API migration explicitly requires it.
2. Update the matching OpenAPI spec for the API class above.
3. Include `operationId`, `tags`, `summary`, at least one success response, and either a security scheme or `security: []` plus `x-security: public` for public probes.
4. Ensure common metadata is present at root or operation level: `x-api-class`, `x-owner`, and `x-stability`.
5. Update validated examples when request/response shapes change.
6. Update narrative docs only when behavior or integration guidance changes; do not duplicate full schemas outside OpenAPI.
7. Update `scripts/check-contract-drift.mjs` when route-file mappings or browser-only exclusions change.
8. Run `npm run contract:check` before merging API changes.

## Idempotency

`Idempotency-Key` is required in the documented contracts for retryable unsafe writes that already read the header and persist/replay writes, including internal recommendation list upserts/batch upserts and public-account conditional list/taste replacements/clears. Other existing mutations are documented without adding new behavior.

## Generated artifacts

Generated artifacts are tracked because contract tooling and downstream consumers reference them:

- `openapi/generated/*.ts` from `npm run contract:types`
- `docs/api/generated/manifest.json` from `npm run docs:api`

Regenerate these artifacts with the commands above instead of editing them by hand.
