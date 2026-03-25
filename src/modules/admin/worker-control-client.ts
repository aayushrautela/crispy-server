import { HttpError } from '../../lib/errors.js';
import { env } from '../../config/env.js';

type FetchJsonMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type WorkerControlJobTarget = 'recommendations_daily' | 'provider_token_maintenance';
export type WorkerControlJobState = 'queued' | 'running' | 'success' | 'error' | 'canceled';

export type WorkerControlJobProgress = {
  phase: string | null;
  message: string | null;
  current: number | null;
  total: number | null;
  percent: number | null;
  processed: number;
  skipped: number;
  errors: number;
  updatedAt: string;
};

export type WorkerControlJobRecord = {
  id: string;
  target: WorkerControlJobTarget;
  script: string;
  args: string[];
  status: WorkerControlJobState;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  pid: number | null;
  cancelRequestedAt: string | null;
  progress: WorkerControlJobProgress;
  stdoutTail: string[];
  stderrTail: string[];
  queuePosition?: number | null;
};

export type WorkerControlJobStatus = {
  ok: boolean;
  activeJobs: WorkerControlJobRecord[];
  queuedJobs: WorkerControlJobRecord[];
  recentJobs: WorkerControlJobRecord[];
  serverTime: string;
};

export type WorkerControlJobTriggerInput = {
  target: WorkerControlJobTarget;
  options?: Record<string, unknown>;
};

export type WorkerControlJobMutationResult = {
  ok: boolean;
  queued?: boolean;
  message?: string;
  error?: string;
  job?: WorkerControlJobRecord;
};

type WorkerControlClientConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
};

type JsonRecord = Record<string, unknown>;

export class WorkerControlClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config?: Partial<WorkerControlClientConfig>) {
    this.baseUrl = normalizeBaseUrl(config?.baseUrl ?? env.recommendationEngineWorkerBaseUrl);
    this.apiKey = (config?.apiKey ?? env.recommendationEngineWorkerApiKey).trim();
    this.timeoutMs = config?.timeoutMs ?? 10_000;
  }

  isConfigured(): boolean {
    return this.baseUrl.length > 0 && this.apiKey.length > 0;
  }

  assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new HttpError(
        503,
        'Recommendation engine worker control bridge is not configured.',
        {
          missing: [
            this.baseUrl ? null : 'RECOMMENDATION_ENGINE_WORKER_BASE_URL',
            this.apiKey ? null : 'RECOMMENDATION_ENGINE_WORKER_API_KEY',
          ].filter(Boolean),
        },
      );
    }
  }

  async getJobStatus(): Promise<WorkerControlJobStatus> {
    this.assertConfigured();
    return this.fetchJson('/internal/v1/worker/jobs/status');
  }

  async triggerJob(input: WorkerControlJobTriggerInput): Promise<WorkerControlJobMutationResult> {
    this.assertConfigured();
    return this.fetchJson('/internal/v1/worker/jobs/trigger', {
      method: 'POST',
      body: input,
    });
  }

  async cancelJob(jobId: string): Promise<WorkerControlJobMutationResult> {
    this.assertConfigured();
    return this.fetchJson(`/internal/v1/worker/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
    });
  }

  async deleteJob(jobId: string): Promise<WorkerControlJobMutationResult> {
    this.assertConfigured();
    return this.fetchJson(`/internal/v1/worker/jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
    });
  }

  private async fetchJson<T>(pathname: string, options?: { method?: FetchJsonMethod; body?: unknown }): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${pathname}`, {
        method: options?.method ?? 'GET',
        headers: {
          accept: 'application/json',
          'x-internal-api-key': this.apiKey,
          ...(options?.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: options?.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = parseJson(text);
      if (!response.ok) {
        const message = readErrorMessage(payload) ?? `Worker control request failed with status ${response.status}.`;
        const errorDetails = payload ?? (text ? { raw: text } : null);
        throw new HttpError(response.status, message, errorDetails);
      }

      return payload as T;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      throw new HttpError(502, 'Recommendation engine worker control request failed.', {
        message: error instanceof Error ? error.message : String(error),
        target: pathname,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
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

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }

  return null;
}
