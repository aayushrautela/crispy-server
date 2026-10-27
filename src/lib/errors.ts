export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code ?? inferHttpErrorCode(statusCode, message);
    this.details = details;
  }
}

export class RateLimitExceededError extends HttpError {
  public readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = 'Rate limit exceeded.') {
    super(429, message, undefined, 'RATE_LIMIT_EXCEEDED');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function inferHttpErrorCode(statusCode: number, message: string): string {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || `http_${statusCode}`;
}

export function assertPresent<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new HttpError(404, message);
  }
  return value;
}
