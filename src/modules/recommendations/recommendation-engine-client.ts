import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { recommendationConfig } from './recommendation-config.js';
import type {
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
    return this.requestJson<RecommendationWorkerSubmitResponse>('/v1/generations', {
      method: 'POST',
      body: input,
      timeoutMs: this.submitTimeoutMs,
      headers: {
        'idempotency-key': options.idempotencyKey,
        'x-request-id': options.requestId,
      },
      emptyMessage: 'Recommendation worker returned an empty submission response.',
      failureMessage: 'Recommendation worker submission failed.',
    });
  }

  async getGenerationStatus(jobId: string, requestId: string): Promise<RecommendationWorkerStatusResponse> {
    return this.requestJson<RecommendationWorkerStatusResponse>(`/v1/generations/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      timeoutMs: this.statusTimeoutMs,
      headers: {
        'x-request-id': requestId,
      },
      emptyMessage: 'Recommendation worker returned an empty status response.',
      failureMessage: 'Recommendation worker status request failed.',
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
      failureMessage: string;
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

      return payload as T;
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
