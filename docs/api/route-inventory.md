# Route inventory

| method | path | api_class | openapi_spec | auth_scheme | notes |
|---|---|---|---|---|---|
| GET | `/v1/me` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/account/settings` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| PATCH | `/v1/account/settings` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/account/secrets/ai-api-key` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| PUT | `/v1/account/secrets/ai-api-key` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| DELETE | `/v1/account/secrets/ai-api-key` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/account/secrets/mdblist-api-key` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| PUT | `/v1/account/secrets/mdblist-api-key` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| DELETE | `/v1/account/secrets/mdblist-api-key` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| DELETE | `/v1/account` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| POST | `/v1/profiles` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| PATCH | `/v1/profiles/{profileId}` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/settings` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| PATCH | `/v1/profiles/{profileId}/settings` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| POST | `/v1/profiles/{profileId}/imports/start` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/imports` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/import-connections` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| DELETE | `/v1/profiles/{profileId}/import-connections/{provider}` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/imports/{jobId}` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/imports/{provider}/callback` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| POST | `/v1/profiles/{profileId}/watch/events` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/watch/continue-watching` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| DELETE | `/v1/profiles/{profileId}/watch/continue-watching/{id}` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/watch/history` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/watch/watchlist` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/watch/ratings` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/watch/state` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| POST | `/v1/profiles/{profileId}/watch/states` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| POST | `/v1/profiles/{profileId}/watch/mark-watched` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| POST | `/v1/profiles/{profileId}/watch/unmark-watched` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| PUT | `/v1/profiles/{profileId}/watch/watchlist/{mediaKey}` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| DELETE | `/v1/profiles/{profileId}/watch/watchlist/{mediaKey}` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| PUT | `/v1/profiles/{profileId}/watch/rating/{mediaKey}` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| DELETE | `/v1/profiles/{profileId}/watch/rating/{mediaKey}` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/metadata/resolve` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/metadata/titles/{mediaKey}` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/metadata/titles/{mediaKey}/reviews` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/metadata/titles/{mediaKey}/ratings` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/metadata/people/{id}` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/playback/resolve` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/search/titles` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/calendar` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/calendar/this-week` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| POST | `/v1/profiles/{profileId}/ai/search` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| POST | `/v1/profiles/{profileId}/ai/insights` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/auth/personal-access-tokens` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| POST | `/v1/auth/personal-access-tokens` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| DELETE | `/v1/auth/personal-access-tokens/{tokenId}` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/taste-profiles` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/taste-profile` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| PUT | `/v1/profiles/{profileId}/taste-profile` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/v1/profiles/{profileId}/recommendations` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| PUT | `/v1/profiles/{profileId}/recommendations` | Public App | `openapi/public-app.v1.yaml` | User session/JWT |  |
| GET | `/api/account/v1/account` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session |  |
| GET | `/api/account/v1/profiles` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session |  |
| GET | `/api/account/v1/profiles/{profileId}` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session |  |
| GET | `/api/account/v1/profiles/{profileId}/recent-watched` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session |  |
| GET | `/api/account/v1/profiles/{profileId}/history` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session |  |
| GET | `/api/account/v1/profiles/{profileId}/watchlist` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session |  |
| GET | `/api/account/v1/profiles/{profileId}/ratings` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session |  |
| GET | `/api/account/v1/profiles/{profileId}/continue-watching` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session |  |
| GET | `/api/account/v1/profiles/{profileId}/recommendations/current` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session |  |
| GET | `/api/account/v1/profiles/{profileId}/language-profile` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session |  |
| GET | `/api/account/v1/profiles/{profileId}/taste/current` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session |  |
| PUT | `/api/account/v1/profiles/{profileId}/recommendations/{listKey}` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session | Idempotency-Key required where documented for retryable writes |
| DELETE | `/api/account/v1/profiles/{profileId}/recommendations/{listKey}` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session | Idempotency-Key required where documented for retryable writes |
| PUT | `/api/account/v1/profiles/{profileId}/taste/current` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session | Idempotency-Key required where documented for retryable writes |
| DELETE | `/api/account/v1/profiles/{profileId}/taste/current` | Public Account | `openapi/public-account.v1.yaml` | PAT bearer or user session | Idempotency-Key required where documented for retryable writes |
| GET | `/internal/apps/v1/me` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| GET | `/internal/apps/v1/profiles/eligible/changes` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| POST | `/internal/apps/v1/profiles/eligible/snapshots` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| GET | `/internal/apps/v1/profiles/eligible/snapshots/{snapshotId}/items` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| GET | `/internal/apps/v1/accounts/{accountId}/profiles/{profileId}/eligibility` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| GET | `/internal/apps/v1/accounts/{accountId}/profiles/{profileId}/signals/recommendation-bundle` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| GET | `/internal/apps/v1/accounts/lookup-by-email/{email}/profiles` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| GET | `/internal/apps/v1/recommendations/service-lists` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| PUT | `/internal/apps/v1/accounts/{accountId}/profiles/{profileId}/recommendations/lists/{listKey}` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| POST | `/internal/apps/v1/recommendations/batch-upsert` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| POST | `/internal/apps/v1/recommendations/runs` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| PATCH | `/internal/apps/v1/recommendations/runs/{runId}` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| POST | `/internal/apps/v1/recommendations/runs/{runId}/batches` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| PATCH | `/internal/apps/v1/recommendations/runs/{runId}/batches/{batchId}` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| GET | `/internal/apps/v1/recommendations/backfills/assignments` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| GET | `/internal/apps/v1/audit/events` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| POST | `/internal/apps/v1/audit/events` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| POST | `/internal/recommendations/v1/accounts/{accountId}/profiles/{profileId}/ai-plan` | Internal Service | `openapi/internal-services.v1.yaml` | Service bearer token | Recommender-facing provider contract |
| POST | `/internal/confidential/v1/accounts/{accountId}/profiles/{profileId}/config-bundle` | Confidential Internal | `openapi/internal-confidential.v1.yaml` | Service bearer token + confidential grants | Restricted publication |
| POST | `/internal/confidential/v1/accounts/{accountId}/profiles/{profileId}/ai-proxy/chat/completions` | Confidential Internal | `openapi/internal-confidential.v1.yaml` | Service bearer token + confidential grants | Restricted publication |
| GET | `/admin/api/diagnostics/recommendations/outbox` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/diagnostics/imports/connections` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/diagnostics/imports/jobs` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/accounts/lookup-by-email/{email}` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| PATCH | `/admin/api/accounts/{accountId}/pricing-tier` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/accounts/{accountId}/profiles` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/accounts/{accountId}/profiles/{profileId}/watch-history` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/accounts/{accountId}/profiles/{profileId}/continue-watching` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/accounts/{accountId}/profiles/{profileId}/watchlist` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/accounts/{accountId}/profiles/{profileId}/ratings` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/accounts/{accountId}/profiles/{profileId}/episodic-follow` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/accounts/{accountId}/profiles/{profileId}/calendar` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/accounts/{accountId}/profiles/{profileId}/calendar/this-week` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/accounts/{accountId}/profiles/{profileId}/taste-profile` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/accounts/{accountId}/profiles/{profileId}/recommendations` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/accounts/{accountId}/profiles/{profileId}/imports/overview` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| POST | `/admin/api/accounts/{accountId}/profiles/{profileId}/imports/start` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| POST | `/admin/api/accounts/{accountId}/profiles/{profileId}/providers/{provider}/refresh-token` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| DELETE | `/admin/api/accounts/{accountId}/profiles/{profileId}/providers/{provider}/connection` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/admin/api/ai/config` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| POST | `/admin/api/ai/test` | Admin/Ops | `openapi/admin-ops.v1.yaml` | Admin session or admin-capable service bearer | Audit/RBAC expected for mutations |
| GET | `/healthz` | Health/Infrastructure | `openapi/health-infrastructure.yaml` | Network/deployment policy | Liveness probe |
| GET | `/admin/login` | UI/Web-only | `excluded` | Admin UI session/CSRF | HTML/browser route, not an API contract |
| POST | `/admin/login` | UI/Web-only | `excluded` | Admin UI session/CSRF | HTML/browser route, not an API contract |
| POST | `/admin/logout` | UI/Web-only | `excluded` | Admin UI session/CSRF | HTML/browser route, not an API contract |
| GET | `/admin` | UI/Web-only | `excluded` | Admin UI session/CSRF | HTML/browser route, not an API contract |
