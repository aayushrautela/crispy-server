import { HttpError } from '../../lib/errors.js';
import { env } from '../../config/env.js';

type JsonRecord = Record<string, unknown>;

export type WorkerBridgeStatus = {
  ok: boolean;
  serverTime: string;
};

type WorkerControlClientConfig = {
  baseUrl: string;
  apiKey: string;
  serviceId: string;
  timeoutMs?: number;
};

export class WorkerControlClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly serviceId: string;
  private readonly timeoutMs: number;

  constructor(config?: Partial<WorkerControlClientConfig>) {
    this.baseUrl = normalizeBaseUrl(config?.baseUrl ?? env.recommendationEngineWorkerBaseUrl);
    this.apiKey = (config?.apiKey ?? env.recommendationEngineWorkerApiKey).trim();
    this.serviceId = (config?.serviceId ?? env.recommendationEngineWorkerServiceId).trim();
    this.timeoutMs = config?.timeoutMs ?? 10_000;
  }

  isConfigured(): boolean {
    return this.baseUrl.length > 0 && this.apiKey.length > 0 && this.serviceId.length > 0;
  }

  assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new HttpError(503, 'Recommendation engine worker bridge is not configured.', {
        missing: [
          this.baseUrl ? null : 'RECOMMENDATION_ENGINE_WORKER_BASE_URL',
          this.apiKey ? null : 'RECOMMENDATION_ENGINE_WORKER_API_KEY',
          this.serviceId ? null : 'RECOMMENDATION_ENGINE_WORKER_SERVICE_ID',
        ].filter(Boolean),
      });
    }
  }

  async getBridgeStatus(): Promise<WorkerBridgeStatus> {
    this.assertConfigured();
    const ready = await this.fetchJson<{ ok?: boolean }>('/ready', { includeAuth: false });
    const stats = await this.fetchJson<{ uptimeSec?: number }>('/v1/stats', { includeAuth: true });
    const uptimeSec = Number(stats && stats.uptimeSec);
    const serverTime = Number.isFinite(uptimeSec)
      ? new Date(Date.now() - Math.max(0, uptimeSec) * 1000).toISOString()
      : new Date().toISOString();
    return {
      ok: ready?.ok !== false,
      serverTime,
    };
  }

  private async fetchJson<T>(pathname: string, options: { includeAuth: boolean }): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
      };

      if (options.includeAuth) {
        headers['x-service-id'] = this.serviceId;
        headers['x-api-key'] = this.apiKey;
        headers['x-request-id'] = `admin-worker-bridge-${Date.now()}`;
      }

      const response = await fetch(`${this.baseUrl}${pathname}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = parseJson(text);
      if (!response.ok) {
        const message = readErrorMessage(payload) ?? `Worker bridge request failed with status ${response.status}.`;
        const errorDetails = payload ?? (text ? { raw: text } : null);
        throw new HttpError(response.status, message, errorDetails);
      }

      return payload as T;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      throw new HttpError(502, 'Recommendation engine worker bridge request failed.', {
        message: error instanceof Error ? error.message : String(error),
        target: pathname,
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
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as JsonRecord;
    }
    return { value };
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
