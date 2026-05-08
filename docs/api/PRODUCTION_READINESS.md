# Production readiness: API contracts

This document describes the production-grade workflow, quality gates, and tooling for maintaining OpenAPI contracts in crispy-server.

## Quality gates

All OpenAPI specs must pass the following checks before merging:

### 1. Contract lint (`npm run contract:lint`)

Validates that every OpenAPI spec:
- Uses OpenAPI 3.1.0
- Defines at least one path and component schema
- Includes root-level metadata: `x-api-class`, `x-owner`, `x-stability`
- Has unique `operationId` for every operation
- Includes `tags`, `summary`, and at least one success response (2xx) for every operation
- Declares security via `security` array or explicit public marker (`security: []` + `x-security: public`)
- Inherits or declares common metadata at operation level: `x-api-class`, `x-owner`, `x-stability`
- Declares all path parameters used in the path template
- Compiles all component schemas successfully
- Validates internal example fixtures against their schemas

### 2. Type generation (`npm run contract:types`)

Generates TypeScript type definitions from every classified spec under `openapi/generated/`. These types are used by route handlers and service layers to ensure type safety between contracts and implementation.

### 3. Route drift detection (`npm run contract:drift`)

Compares implemented Fastify routes with documented OpenAPI paths/methods. This best-effort check:
- Normalizes Express-style `:param` to OpenAPI-style `{param}`
- Excludes UI/static/non-contract routes (admin login/logout, OAuth callbacks)
- Reports undocumented routes (implemented but missing from OpenAPI)
- Reports unimplemented paths (documented but not implemented)

The drift checker uses a static mapping of specs to route files. When adding new route files, update `scripts/check-contract-drift.mjs`.

### 4. API docs artifact (`npm run docs:api`)

Generates a static manifest under `docs/api/generated/manifest.json` listing:
- All OpenAPI specs and their API classes
- Generated TypeScript type files
- Verification commands
- Documentation references

This artifact can be used by CI/CD pipelines, documentation sites, or developer tooling.

### 5. Combined check (`npm run contract:check`)

Runs all quality gates in sequence: lint → types → drift → docs. Use this command in CI before merging API changes.

## Workflow: adding a new endpoint

1. **Implement the route** in the appropriate route file under `src/http/routes/`. Do not move existing endpoint paths.

2. **Document in OpenAPI** by adding or updating the path in the matching API class spec:
   - Public App API: `openapi/public-app.v1.yaml`
   - Public Account API: `openapi/public-account.v1.yaml`
   - Internal Service API: `openapi/internal-services.v1.yaml`
   - Confidential Internal API: `openapi/internal-confidential.v1.yaml`
   - Admin/Ops API: `openapi/admin-ops.v1.yaml`
   - Health/Infrastructure: `openapi/health-infrastructure.yaml`

3. **Include required operation metadata**:
   - `operationId`: unique identifier (e.g., `getProfileHistory`)
   - `tags`: array of tags for grouping (e.g., `["Profiles"]`)
   - `summary`: concise description of what the operation does
   - `responses`: at least one success response (200, 201, 204, etc.)
   - `security`: either a security scheme reference or `security: []` with `x-security: public` for public probes

4. **Ensure common metadata** is present at root or operation level:
   - `x-api-class`: API classification (e.g., `public-app`, `internal-service`)
   - `x-owner`: owning team or service (e.g., `crispy-server`)
   - `x-stability`: stability level (e.g., `stable`, `beta`, `experimental`)

5. **Update route inventory** in `docs/api/route-inventory.md` if the route is contract-worthy or intentionally excluded.

6. **Run quality checks** before committing:
   ```bash
   npm run contract:check
   npm run typecheck
   ```

7. **Commit and push** with a clear commit message describing the endpoint and its purpose.

## Workflow: modifying an existing endpoint

1. **Update the implementation** in the route file.

2. **Update the OpenAPI spec** to reflect the change (new parameters, response fields, status codes, etc.).

3. **Update examples** if the change affects request/response shapes validated in `scripts/validate-openapi-contract.mjs`.

4. **Run quality checks**:
   ```bash
   npm run contract:check
   npm run typecheck
   ```

5. **Update route inventory** if the change affects the documented contract (new path, method, or security scheme).

## Idempotency

`Idempotency-Key` is required in the documented contracts for retryable unsafe writes that already read the header and persist/replay writes:
- Internal recommendation list upserts and batch upserts
- Public-account conditional list/taste replacements and clears

Other existing mutations are documented without adding a new path or behavior change.

## Security markers

All operations must declare security:
- **Authenticated operations**: use `security` array referencing a security scheme (e.g., `bearerAuth`, `sessionAuth`)
- **Public operations**: use `security: []` (empty array) plus `x-security: public` to explicitly mark as public

The health probe (`GET /healthz`) is the canonical example of a public operation.

## Drift checker limitations

The drift checker is a best-effort tool with known limitations:
- Static mapping of specs to route files (manual updates required for new files)
- Does not detect parameter mismatches (only path/method presence)
- Does not validate request/response body shapes (use contract:lint for schema validation)
- Excludes UI/static routes via hardcoded list (update `scripts/check-contract-drift.mjs` for new exclusions)

Despite these limitations, the drift checker catches the most common contract violations: undocumented routes and unimplemented paths.

## CI integration

Add the following to your CI pipeline before merging:

```yaml
- name: Validate API contracts
  run: npm run contract:check

- name: Type check
  run: npm run typecheck
```

This ensures all API changes pass quality gates before reaching production.

## Troubleshooting

### "missing operationId"
Every operation must have a unique `operationId`. Add one to the operation in the OpenAPI spec.

### "missing tags"
Every operation must have at least one tag. Add a `tags` array to the operation.

### "missing summary"
Every operation must have a `summary` field. Add a concise description of what the operation does.

### "missing success response"
Every operation must define at least one 2xx response. Add a `200`, `201`, or `204` response to the `responses` object.

### "missing security or explicit public marker"
Every operation must declare security. Either:
- Add a `security` array referencing a security scheme, or
- Add `security: []` (empty array) plus `x-security: public` for public operations

### "missing x-api-class / x-owner / x-stability"
These metadata fields must be present at root or operation level. If defined at root, all operations inherit them. If not, add them to each operation.

### "UNDOCUMENTED ROUTES"
The drift checker found routes implemented in code but not documented in OpenAPI. Add the missing paths to the appropriate spec.

### "UNIMPLEMENTED PATHS"
The drift checker found paths documented in OpenAPI but not implemented in code. Either implement the route or remove it from the spec if it was documented prematurely.

### "duplicate operationId"
Two operations share the same `operationId`. Make each `operationId` unique across the spec.

### "missing path parameter"
The path template includes `{param}` but the operation does not declare it in `parameters`. Add the path parameter to the operation or reference a shared parameter from `components.parameters`.
