import { HttpError } from '../../lib/errors.js';
import type { RecommendationAiPlanRequest } from './recommendation-ai-plan.types.js';

const FORBIDDEN_AI_TRANSPORT_FIELDS = [
  'provider',
  'model',
  'endpointUrl',
  'proxyEndpoint',
  'proxyUrl',
  'apiKey',
  'token',
  'messages',
  'prompt',
  'systemPrompt',
  'userPrompt',
  'openai',
  'configBundle',
  'aiConfig',
  'secretDelivery',
];

export function validateAiPlanRequest(body: unknown): asserts body is RecommendationAiPlanRequest {
  if (!body || typeof body !== 'object') {
    throw new HttpError(400, 'Request body must be an object', { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  const req = body as Record<string, unknown>;

  for (const field of FORBIDDEN_AI_TRANSPORT_FIELDS) {
    if (field in req) {
      throw new HttpError(400, `Field '${field}' is not allowed in AI plan request`, {
        code: 'INVALID_AI_PLAN_REQUEST',
      });
    }
  }

  if (typeof req.schemaVersion !== 'number') {
    throw new HttpError(400, 'schemaVersion must be a number', { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  if (req.schemaVersion !== 1) {
    throw new HttpError(400, `Unsupported schema version: ${req.schemaVersion}`, {
      code: 'UNSUPPORTED_AI_PLAN_SCHEMA_VERSION',
    }, 'UNSUPPORTED_AI_PLAN_SCHEMA_VERSION');
  }

  if (typeof req.requestId !== 'string' || !req.requestId) {
    throw new HttpError(400, 'requestId is required', { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  if (typeof req.runId !== 'string' || !req.runId) {
    throw new HttpError(400, 'runId is required', { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  if (typeof req.listKey !== 'string' || !req.listKey) {
    throw new HttpError(400, 'listKey is required', { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  if (req.intent !== 'generate_recommendation_plan') {
    throw new HttpError(400, `Invalid intent: ${req.intent}`, { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  if (typeof req.locale !== 'string' || !req.locale) {
    throw new HttpError(400, 'locale is required', { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  if (typeof req.generatedAt !== 'string' || !req.generatedAt) {
    throw new HttpError(400, 'generatedAt is required', { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  if (!req.constraints || typeof req.constraints !== 'object') {
    throw new HttpError(400, 'constraints is required', { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  if (!req.profile || typeof req.profile !== 'object') {
    throw new HttpError(400, 'profile is required', { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  const profile = req.profile as Record<string, unknown>;
  if (typeof profile.accountId !== 'string' || !profile.accountId) {
    throw new HttpError(400, 'profile.accountId is required', { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  if (typeof profile.profileId !== 'string' || !profile.profileId) {
    throw new HttpError(400, 'profile.profileId is required', { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  if (!req.signals || typeof req.signals !== 'object') {
    throw new HttpError(400, 'signals is required', { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  if (!Array.isArray(req.candidatePool)) {
    throw new HttpError(400, 'candidatePool must be an array', { code: 'INVALID_AI_PLAN_REQUEST' });
  }

  if (req.candidatePool.length === 0) {
    throw new HttpError(422, 'candidatePool cannot be empty', { code: 'EMPTY_CANDIDATE_POOL' }, 'EMPTY_CANDIDATE_POOL');
  }
}

export function validatePathBodyMatch(
  pathAccountId: string,
  pathProfileId: string,
  request: RecommendationAiPlanRequest,
): void {
  if (request.profile.accountId !== pathAccountId) {
    throw new HttpError(400, 'Path accountId does not match request body profile.accountId', {
      code: 'INVALID_AI_PLAN_REQUEST',
    });
  }

  if (request.profile.profileId !== pathProfileId) {
    throw new HttpError(400, 'Path profileId does not match request body profile.profileId', {
      code: 'INVALID_AI_PLAN_REQUEST',
    });
  }
}
