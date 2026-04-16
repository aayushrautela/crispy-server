import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { recommendationConfig } from './recommendation-config.js';
import type {
  RecommendationWorkerFailure,
  RecommendationWorkerGenerateResponse,
  RecommendationWorkerGenerateRequest,
  RecommendationWorkerStatusResponse,
  RecommendationWorkerSubmitResponse,
} from './recommendation-worker.types.js';

type JsonRecord = Record<string, unknown>;

type RecommendationEngineClientConfig = {
  baseUrl: string;
  apiKey: string;
  serviceId: string;
  submitTimeoutMs: number;
  statusTimeoutMs: number;
};

export class RecommendationEngineClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly serviceId: string;
  private readonly submitTimeoutMs: number;
  private readonly statusTimeoutMs: number;

  constructor(config?: Partial<RecommendationEngineClientConfig>) {
    this.baseUrl = normalizeBaseUrl(config?.baseUrl ?? env.recommendationEngineWorkerBaseUrl);
    this.apiKey = (config?.apiKey ?? env.recommendationEngineWorkerApiKey).trim();
    this.serviceId = (config?.serviceId ?? env.recommendationEngineWorkerServiceId).trim();
    this.submitTimeoutMs = config?.submitTimeoutMs ?? recommendationConfig.workerSubmitTimeoutMs;
    this.statusTimeoutMs = config?.statusTimeoutMs ?? recommendationConfig.workerStatusTimeoutMs;
  }

  isConfigured(): boolean {
    return this.baseUrl.length > 0 && this.apiKey.length > 0 && this.serviceId.length > 0;
  }

  assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new HttpError(503, 'Recommendation generation worker is not configured.', {
        missing: [
          this.baseUrl ? null : 'RECOMMENDATION_ENGINE_WORKER_BASE_URL',
          this.apiKey ? null : 'RECOMMENDATION_ENGINE_WORKER_API_KEY',
          this.serviceId ? null : 'RECOMMENDATION_ENGINE_WORKER_SERVICE_ID',
        ].filter(Boolean),
      });
    }
  }

  async submitGeneration(
    input: RecommendationWorkerGenerateRequest,
    options: { idempotencyKey: string; requestId: string },
  ): Promise<RecommendationWorkerSubmitResponse> {
    return this.requestJson('/v1/generations', {
      method: 'POST',
      body: input,
      timeoutMs: this.submitTimeoutMs,
      headers: {
        'idempotency-key': options.idempotencyKey,
        'x-request-id': options.requestId,
      },
      emptyMessage: 'Recommendation worker returned an empty submission response.',
      invalidMessage: 'Recommendation worker returned an invalid submission response.',
      failureMessage: 'Recommendation worker submission failed.',
      validate: validateSubmitResponse,
    });
  }

  async getGenerationStatus(jobId: string, requestId: string): Promise<RecommendationWorkerStatusResponse> {
    return this.requestJson(`/v1/generations/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      timeoutMs: this.statusTimeoutMs,
      headers: {
        'x-request-id': requestId,
      },
      emptyMessage: 'Recommendation worker returned an empty status response.',
      invalidMessage: 'Recommendation worker returned an invalid status response.',
      failureMessage: 'Recommendation worker status request failed.',
      validate: validateStatusResponse,
    });
  }

  private async requestJson<T>(
    path: string,
    options: {
      method: 'GET' | 'POST';
      body?: JsonRecord;
      timeoutMs: number;
      headers?: Record<string, string>;
      emptyMessage: string;
      invalidMessage: string;
      failureMessage: string;
      validate: (payload: JsonRecord, invalidMessage: string) => T;
    },
  ): Promise<T> {
    this.assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          accept: 'application/json',
          'x-service-id': this.serviceId,
          'x-api-key': this.apiKey,
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(options.headers ?? {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = parseJson(text);
      if (!response.ok) {
        const message = readErrorMessage(payload) ?? `Recommendation worker request failed with status ${response.status}.`;
        throw new HttpError(response.status, message, payload ?? (text ? { raw: text } : null));
      }

      if (!payload) {
        throw new HttpError(502, options.emptyMessage);
      }

      return options.validate(payload, options.invalidMessage);
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      throw new HttpError(502, options.failureMessage, {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function validateSubmitResponse(payload: JsonRecord, invalidMessage: string): RecommendationWorkerSubmitResponse {
  return {
    jobId: readRequiredString(payload.jobId, invalidMessage, 'jobId'),
    status: readRequiredStatus(payload.status, invalidMessage),
    idempotencyKey: readRequiredString(payload.idempotencyKey, invalidMessage, 'idempotencyKey'),
    acceptedAt: readNullableString(payload.acceptedAt, invalidMessage, 'acceptedAt'),
    statusUrl: readNullableString(payload.statusUrl, invalidMessage, 'statusUrl'),
    pollAfterSeconds: readNullableNumber(payload.pollAfterSeconds, invalidMessage, 'pollAfterSeconds'),
  };
}

function validateStatusResponse(payload: JsonRecord, invalidMessage: string): RecommendationWorkerStatusResponse {
  const result = readNullableRecord(payload.result, invalidMessage, 'result');
  const failure = readNullableRecord(payload.failure, invalidMessage, 'failure');
  return {
    jobId: readRequiredString(payload.jobId, invalidMessage, 'jobId'),
    status: readRequiredStatus(payload.status, invalidMessage),
    idempotencyKey: readRequiredString(payload.idempotencyKey, invalidMessage, 'idempotencyKey'),
    acceptedAt: readNullableString(payload.acceptedAt, invalidMessage, 'acceptedAt'),
    startedAt: readNullableString(payload.startedAt, invalidMessage, 'startedAt'),
    completedAt: readNullableString(payload.completedAt, invalidMessage, 'completedAt'),
    cancelledAt: readNullableString(payload.cancelledAt, invalidMessage, 'cancelledAt'),
    pollAfterSeconds: readNullableNumber(payload.pollAfterSeconds, invalidMessage, 'pollAfterSeconds'),
    result: result as RecommendationWorkerGenerateResponse | null,
    failure: failure as RecommendationWorkerFailure | null,
  };
}

function readRequiredStatus(value: unknown, invalidMessage: string): RecommendationWorkerStatusResponse['status'] {
  if (value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'cancelled') {
    return value;
  }
  throw invalidWorkerPayload(invalidMessage, 'status');
}

function readRequiredString(value: unknown, invalidMessage: string, field: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  throw invalidWorkerPayload(invalidMessage, field);
}

function readNullableString(value: unknown, invalidMessage: string, field: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  throw invalidWorkerPayload(invalidMessage, field);
}

function readNullableNumber(value: unknown, invalidMessage: string, field: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  throw invalidWorkerPayload(invalidMessage, field);
}

function readNullableRecord(value: unknown, invalidMessage: string, field: string): JsonRecord | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  throw invalidWorkerPayload(invalidMessage, field);
}

function invalidWorkerPayload(message: string, field: string): HttpError {
  return new HttpError(502, message, { field });
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function parseJson(text: string): JsonRecord | null {
  if (!text.trim()) {
    return null;
  }

  try {
    const value = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as JsonRecord
      : { value };
  } catch {
    return { raw: text };
  }
}

function readErrorMessage(payload: JsonRecord | null): string | null {
  if (!payload) {
    return null;
  }

  const nestedError = payload.error;
  if (typeof nestedError === 'object' && nestedError !== null && !Array.isArray(nestedError)) {
    const nestedMessage = (nestedError as JsonRecord).message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
      return nestedMessage;
    }
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }

  return null;
}
