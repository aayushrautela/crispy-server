import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import Ajv from 'ajv';
import YAML from 'yaml';

const root = process.cwd();
const specFiles = [
  'openapi/public-app.v1.yaml',
  'openapi/public-account.v1.yaml',
  'openapi/internal-services.v1.yaml',
  'openapi/internal-recommender.v1.yaml',
  'openapi/admin-ops.v1.yaml',
  'openapi/health-infrastructure.yaml',
];

function readYaml(relativePath) {
  return YAML.parse(readFileSync(resolve(root, relativePath), 'utf8'));
}

function hasSuccessResponse(responses) {
  return Object.keys(responses ?? {}).some((statusCode) => /^2\d\d$/.test(statusCode));
}

function hasSecurityMarker(operation, spec) {
  return Object.prototype.hasOwnProperty.call(operation, 'security')
    || Object.prototype.hasOwnProperty.call(spec, 'security')
    || operation['x-security'] === 'public';
}

function assertMetadata(operation, spec, metadataKey, relativePath, operationId) {
  if (operation[metadataKey] ?? spec[metadataKey]) return;
  throw new Error(`${relativePath}: ${operationId} missing ${metadataKey} at root or operation level`);
}

function assertSpec(relativePath) {
  const spec = readYaml(relativePath);
  if (spec.openapi !== '3.1.0') throw new Error(`${relativePath}: expected OpenAPI 3.1.0`);
  if (!spec.paths || Object.keys(spec.paths).length === 0) throw new Error(`${relativePath}: OpenAPI document must define paths.`);
  if (!spec.components?.schemas) throw new Error(`${relativePath}: OpenAPI document must define component schemas.`);
  if (!spec['x-api-class']) throw new Error(`${relativePath}: missing root x-api-class`);
  if (!spec['x-owner']) throw new Error(`${relativePath}: missing root x-owner`);
  if (!spec['x-stability']) throw new Error(`${relativePath}: missing root x-stability`);
  const operationIds = new Set();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item?.[method];
      if (!operation) continue;
      if (!operation.operationId) throw new Error(`${relativePath}: ${method.toUpperCase()} ${path} missing operationId`);
      if (operationIds.has(operation.operationId)) throw new Error(`${relativePath}: duplicate operationId ${operation.operationId}`);
      operationIds.add(operation.operationId);
      if (!Array.isArray(operation.tags) || operation.tags.length === 0) throw new Error(`${relativePath}: ${operation.operationId} missing tags`);
      if (!operation.summary) throw new Error(`${relativePath}: ${operation.operationId} missing summary`);
      if (!operation.responses || Object.keys(operation.responses).length === 0) throw new Error(`${relativePath}: ${operation.operationId} missing responses`);
      if (!hasSuccessResponse(operation.responses)) throw new Error(`${relativePath}: ${operation.operationId} missing success response`);
      if (!hasSecurityMarker(operation, spec)) throw new Error(`${relativePath}: ${operation.operationId} missing security or explicit public marker`);
      assertMetadata(operation, spec, 'x-api-class', relativePath, operation.operationId);
      assertMetadata(operation, spec, 'x-owner', relativePath, operation.operationId);
      assertMetadata(operation, spec, 'x-stability', relativePath, operation.operationId);
      if (path.includes('{')) {
        const declared = new Set((operation.parameters ?? [])
          .filter((parameter) => {
            if (parameter.in === 'path') return true;
            if (typeof parameter.$ref !== 'string') return false;
            const parameterName = parameter.$ref.split('/').pop();
            return spec.components?.parameters?.[parameterName]?.in === 'path';
          })
          .map((parameter) => {
            if (parameter.name) return parameter.name;
            const parameterName = parameter.$ref.split('/').pop();
            return spec.components.parameters[parameterName].name;
          }));
        for (const name of path.matchAll(/\{([^}]+)\}/g)) {
          if (!declared.has(name[1])) throw new Error(`${relativePath}: ${operation.operationId} missing path parameter ${name[1]}`);
        }
      }
    }
  }
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  for (const [name, schema] of Object.entries(spec.components.schemas)) {
    ajv.addSchema(schema, `#/components/schemas/${name}`);
  }
  for (const name of Object.keys(spec.components.schemas)) {
    if (!ajv.getSchema(`#/components/schemas/${name}`)) throw new Error(`${relativePath}: failed to compile schema ${name}`);
  }
  return { spec, validators: new Map(Object.keys(spec.components.schemas).map((name) => [name, ajv.getSchema(`#/components/schemas/${name}`)])), ajv };
}

const validated = new Map(specFiles.map((file) => [file, assertSpec(file)]));

function readJson(relativePath) { return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8')); }
function validate(specFile, schemaName, relativePath) {
  const entry = validated.get(specFile);
  const validator = entry?.validators.get(schemaName);
  if (!validator) throw new Error(`${specFile}: missing schema ${schemaName}`);
  const data = readJson(relativePath);
  if (!validator(data)) throw new Error(`${relativePath} does not validate against ${schemaName}: ${entry.ajv.errorsText(validator.errors, { separator: '\n' })}`);
}

const internalSpec = 'openapi/internal-services.v1.yaml';
for (const [schema, file] of [
  ['AppSelfResponse', 'openapi/examples/auth-me/response.success.json'],
  ['EligibleProfileChangesResponse', 'openapi/examples/eligible-changes/response.page.json'],
  ['EligibleProfileChangesResponse', 'openapi/examples/eligible-changes/response.empty.json'],
  ['EligibleProfileSnapshotCreateRequest', 'openapi/examples/eligible-snapshots/request.valid.json'],
  ['EligibleProfileSnapshotResponse', 'openapi/examples/eligible-snapshots/response.created.json'],
  ['EligibleProfileSnapshotItemsResponse', 'openapi/examples/eligible-snapshots/items.response.page.json'],
  ['EligibleProfileSnapshotItemsResponse', 'openapi/examples/eligible-snapshots/items.response.empty.json'],
  ['ProfileEligibilityResponse', 'openapi/examples/profile-eligibility/response.eligible.json'],
  ['ProfileEligibilityResponse', 'openapi/examples/profile-eligibility/response.ineligible.json'],
  ['RecommendationSignalBundleResponse', 'openapi/examples/signal-bundle/response.full.json'],
  ['RecommendationSignalBundleResponse', 'openapi/examples/signal-bundle/response.minimal.json'],
  ['RecommendationListUpsertRequest', 'openapi/examples/recommendation-list-upsert/request.valid.json'],
  ['CanonicalErrorEnvelope', 'openapi/examples/recommendation-list-upsert/error.unsupported-field.json'],
  ['RecommendationBatchUpsertRequest', 'openapi/examples/batch-upsert/request.valid.json'],
  ['RecommendationBatchUpsertResponse', 'openapi/examples/batch-upsert/response.success.json'],
  ['RecommendationBatchUpsertResponse', 'openapi/examples/batch-upsert/response.partial-failure.json'],
  ['RecommendationRunCreateRequest', 'openapi/examples/recommendation-runs/create.request.json'],
  ['RecommendationRunResponse', 'openapi/examples/recommendation-runs/create.response.json'],
  ['RecommendationRunPatchRequest', 'openapi/examples/recommendation-runs/patch.request.running.json'],
  ['RecommendationRunPatchRequest', 'openapi/examples/recommendation-runs/patch.request.completed.json'],
  ['RecommendationRunResponse', 'openapi/examples/recommendation-runs/update.response.json'],
  ['RecommendationRunBatchCreateRequest', 'openapi/examples/recommendation-batches/create.request.json'],
  ['RecommendationRunBatchResponse', 'openapi/examples/recommendation-batches/create.response.json'],
  ['RecommendationRunBatchPatchRequest', 'openapi/examples/recommendation-batches/patch.request.completed.json'],
  ['RecommendationRunBatchPatchRequest', 'openapi/examples/recommendation-batches/patch.request.failed.json'],
  ['RecommendationRunBatchResponse', 'openapi/examples/recommendation-batches/update.response.json'],
  ['AppAuditEventWriteRequest', 'openapi/examples/audit-events/write.request.success.json'],
  ['AppAuditEventWriteResponse', 'openapi/examples/audit-events/write.response.created.json'],
  ['AppAuditEventsResponse', 'openapi/examples/audit-events/read.response.page.json'],
  ['BackfillAssignmentsResponse', 'openapi/examples/backfills/assignments.response.page.json'],
  ['AccountLookupResponse', 'openapi/examples/account-lookup/response.success.json'],
]) validate(internalSpec, schema, file);
const upsertRequestValidator = validated.get(internalSpec).validators.get('RecommendationListUpsertRequest');
if (upsertRequestValidator(readJson('openapi/examples/recommendation-list-upsert/request.unsupported-content-id.json'))) throw new Error('Unsupported contentId write fixture unexpectedly validated.');
const errorValidator = validated.get(internalSpec).validators.get('CanonicalErrorEnvelope');
if (errorValidator({ code: 'ai_provider_unavailable', message: 'AI provider unavailable', details: { code: 'AI_PLAN_PROVIDER_UNAVAILABLE' } })) throw new Error('Legacy unwrapped error shape unexpectedly validated.');
if (errorValidator({ error: { code: 'ai_provider_unavailable', message: 'AI provider unavailable', category: 'upstream_dependency', retryable: true, requestId: 'req_example_legacy', details: { code: 'AI_PLAN_PROVIDER_UNAVAILABLE' } } })) throw new Error('Legacy nested-code AI error shape unexpectedly validated.');
console.log(`OpenAPI contracts parsed and examples validated (${specFiles.length} specs).`);
