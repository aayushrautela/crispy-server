import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import Ajv from 'ajv';
import YAML from 'yaml';

const root = process.cwd();
const specPath = resolve(root, 'openapi/internal-recommender.v1.yaml');
const spec = YAML.parse(readFileSync(specPath, 'utf8'));

if (spec.openapi !== '3.1.0') {
  throw new Error(`Expected OpenAPI 3.1.0, received ${String(spec.openapi)}`);
}

if (!spec.paths || Object.keys(spec.paths).length === 0) {
  throw new Error('OpenAPI document must define paths.');
}

const schemas = spec.components?.schemas;
if (!schemas) {
  throw new Error('OpenAPI document must define component schemas.');
}

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
for (const [name, schema] of Object.entries(schemas)) {
  ajv.addSchema(schema, `#/components/schemas/${name}`);
}
const validators = new Map();
for (const name of Object.keys(schemas)) {
  const validator = ajv.getSchema(`#/components/schemas/${name}`);
  if (!validator) {
    throw new Error(`Failed to compile schema ${name}`);
  }
  validators.set(name, validator);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'));
}

function validate(schemaName, relativePath) {
  const validator = validators.get(schemaName);
  if (!validator) {
    throw new Error(`Missing schema ${schemaName}`);
  }

  const data = readJson(relativePath);
  if (!validator(data)) {
    throw new Error(`${relativePath} does not validate against ${schemaName}: ${ajv.errorsText(validator.errors, { separator: '\n' })}`);
  }
}

validate('RecommendationListUpsertRequest', 'openapi/examples/recommendation-list-upsert/request.valid.json');
validate('CanonicalErrorEnvelope', 'openapi/examples/recommendation-list-upsert/error.unsupported-field.json');
validate('RecommendationAiPlanRequest', 'openapi/examples/ai-plan/request.valid.json');
validate('RecommendationAiPlanResponse', 'openapi/examples/ai-plan/response.success.json');

for (const file of [
  'openapi/examples/ai-plan/error.provider-unavailable.json',
  'openapi/examples/ai-plan/error.timeout.json',
  'openapi/examples/ai-plan/error.invalid-vendor-output.json',
  'openapi/examples/ai-plan/error.output-validation-failed.json',
  'openapi/examples/ai-plan/error.internal-error.json',
]) {
  validate('CanonicalErrorEnvelope', file);
}

const upsertRequestValidator = validators.get('RecommendationListUpsertRequest');
if (!upsertRequestValidator) {
  throw new Error('Missing RecommendationListUpsertRequest schema');
}
if (upsertRequestValidator(readJson('openapi/examples/recommendation-list-upsert/request.unsupported-content-id.json'))) {
  throw new Error('Unsupported contentId write fixture unexpectedly validated.');
}

const errorValidator = validators.get('CanonicalErrorEnvelope');
if (!errorValidator) {
  throw new Error('Missing CanonicalErrorEnvelope schema');
}
const legacyWrappedError = {
  code: 'ai_provider_unavailable',
  message: 'AI provider unavailable',
  details: { code: 'AI_PLAN_PROVIDER_UNAVAILABLE' },
};
if (errorValidator(legacyWrappedError)) {
  throw new Error('Legacy unwrapped error shape unexpectedly validated.');
}
const legacyNestedCodeEnvelope = {
  error: {
    code: 'ai_provider_unavailable',
    message: 'AI provider unavailable',
    category: 'upstream_dependency',
    retryable: true,
    requestId: 'req_example_legacy',
    details: { code: 'AI_PLAN_PROVIDER_UNAVAILABLE' },
  },
};
if (errorValidator(legacyNestedCodeEnvelope)) {
  throw new Error('Legacy nested-code AI error shape unexpectedly validated.');
}

console.log('OpenAPI contract parsed and examples validated.');
