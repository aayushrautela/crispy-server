# Documentation Index

This directory contains current Crispy Server documentation.

## Current source-of-truth docs

| Document | Purpose |
| --- | --- |
| `../README.md` | Project overview, runtime components, local development |
| `../architecture.md` | Current backend architecture contract |
| `../AGENT.md` | Agent-facing repository guidance and architecture facts |
| `../DEPLOY.md` | Deployment guide |
| `api/README.md` | API contract ownership, OpenAPI workflow, quality gates |
| `api/media-state.md` | Client media identity and watch-state behavior guide |
| `api/recommendations.md` | Recommendation API behavior and operator guidance |
| `architecture/recommendation-engine.md` | Current MAIN/RECO boundary and security model |
| `specs/client-reco-pipeline-spec.md` | Target client recommendation and RECO contract split |
| `specs/client-reco-pipeline-implementation-plan.md` | Hard-cutover implementation plan for recommendation cleanup |

## Contract ownership

OpenAPI is the machine-readable source of truth for exact HTTP contracts:

- `openapi/public-app.v1.yaml`
- `openapi/public-account.v1.yaml`
- `openapi/internal-services.v1.yaml`
- `openapi/internal-recommender.v1.yaml`
- `openapi/internal-confidential.v1.yaml`
- `openapi/admin-ops.v1.yaml`
- `openapi/health-infrastructure.yaml`

Narrative docs should not duplicate full endpoint payload maps. They should explain behavior, ownership, architecture decisions, and migration plans.
