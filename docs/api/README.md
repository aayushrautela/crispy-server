# API classification

Crispy server publishes separate OpenAPI documents by audience. Endpoint paths are documented as implemented; no endpoint moves are implied by this split.

| Class | Prefixes | Spec | Consumers | Security |
|---|---|---|---|---|
| Public App API | `/v1/**` | `openapi/public-app.v1.yaml` | first-party app clients | user bearer/session auth |
| Public Account API | `/api/account/v1/**` | `openapi/public-account.v1.yaml` | user-owned integrations and PAT clients | PAT bearer or user auth |
| Internal Service API | `/internal/apps/v1/**`, `/internal/recommendations/v1/**` | `openapi/internal-services.v1.yaml` (`internal-recommender.v1.yaml` retained for recommender compatibility) | trusted backend services | service bearer token plus app scopes |
| Confidential Internal API | `/internal/confidential/v1/**` | `openapi/internal-confidential.v1.yaml` | highly trusted server components | service identity, allowlists, audit |
| Admin/Ops API | `/admin/api/**` | `openapi/admin-ops.v1.yaml` | admin console/operators | admin session or service bearer where allowed |
| Health/Infrastructure | probes such as `/healthz` | `openapi/health-infrastructure.yaml` | load balancers/orchestrators | deployment/network policy |

Browser-only admin UI routes (`/admin`, `/admin/login`, `/admin/logout`) are intentionally excluded from API specs and listed only in the route inventory.

## Idempotency

`Idempotency-Key` is required in the documented contracts for retryable unsafe writes that already read the header and persist/replay writes: internal recommendation list upserts/batch upserts and public-account conditional list/taste replacements/clears. Other existing mutations are documented without adding a new path or behavior change.

## Contract checks

- `npm run contract:lint` parses all classified specs, checks operation metadata/path params/security markers/success responses, and validates the internal examples.
- `npm run contract:types` generates TypeScript types for every classified spec under `openapi/generated/`.
- `npm run contract:drift` compares contract-worthy Fastify routes with documented OpenAPI paths/methods, normalizing `:param` to `{param}` and excluding UI/static routes.
- `npm run docs:api` generates the static API docs manifest under `docs/api/generated/`.
- `npm run contract:test` runs lint and type generation.
- `npm run contract:check` is the CI-friendly quality gate for lint, types, route drift, and docs artifact generation.

## Adding endpoints

1. Implement the route without moving existing endpoint paths.
2. Add or update the matching OpenAPI path in the appropriate class spec.
3. Include `operationId`, `tags`, `summary`, success response, and either `security` or `security: []` plus `x-security: public` for public probes.
4. Ensure common metadata is present at root or operation level: `x-api-class`, `x-owner`, and `x-stability`.
5. Update `docs/api/route-inventory.md` if the route is contract-worthy or intentionally excluded.
6. Run `npm run contract:check` before merging.
