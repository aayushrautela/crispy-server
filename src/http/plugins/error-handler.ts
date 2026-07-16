import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { HttpError, inferHttpErrorCode } from '../../lib/errors.js';
import { AppAuthError } from '../../modules/apps/app-auth.errors.js';
import type { ApiErrorResponse } from '../contracts/shared.js';

const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    
    if (error instanceof AppAuthError) {
      void reply.status(error.statusCode).send(toErrorResponse(request, error.statusCode, error.code, error.message));
      return;
    }

    if (error instanceof HttpError) {
      void reply.status(error.statusCode).send(toErrorResponse(request, error.statusCode, error.code, error.message, error.details));
      return;
    }

    if (isFastifyValidationError(error)) {
      void reply.status(error.statusCode).send(
        toErrorResponse(request, error.statusCode, 'VALIDATION_FAILED', 'Request validation failed.', formatValidationDetails(error.validation)),
      );
      return;
    }

    if (isClientError(error)) {
      void reply.status(error.statusCode).send(
        toErrorResponse(request, error.statusCode, inferHttpErrorCode(error.statusCode, error.message), error.message),
      );
      return;
    }

    const message = 'Internal server error';

    void reply.status(500).send(toErrorResponse(request, 500, inferHttpErrorCode(500, message), message));
  });
};

type FastifyValidationIssue = {
  instancePath?: string;
  message?: string;
  keyword?: string;
  params?: Record<string, unknown>;
};

type FastifyValidationError = {
  statusCode: number;
  validation: FastifyValidationIssue[];
};

type ClientError = {
  statusCode: number;
  message: string;
};

function toErrorResponse(request: FastifyRequest, statusCode: number, code: string, message: string, details?: unknown): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      category: errorCategory(statusCode, code),
      retryable: isRetryable(statusCode, code),
      requestId: getRequestId(request),
      details: sanitizeDetails(details) ?? null,
    },
  };
}

function getRequestId(request: FastifyRequest): string {
  const header = request.headers['x-request-id'];
  if (typeof header === 'string' && header.trim()) return header;
  return request.id;
}

function sanitizeDetails(details: unknown): unknown {
  if (details === undefined || details === null) return null;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const { code: _code, ...rest } = details as Record<string, unknown>;
    return Object.keys(rest).length > 0 ? rest : null;
  }
  return details;
}

function errorCategory(statusCode: number, code: string): ApiErrorResponse['error']['category'] {
  if (statusCode === 401) return 'authentication';
  if (statusCode === 403) return 'authorization';
  if (statusCode === 404) return 'not_found';
  if (statusCode === 409) return 'conflict';
  if (statusCode === 429) return 'rate_limit';
  if (statusCode === 504 || code.includes('TIMEOUT')) return 'timeout';
  if (statusCode === 502 || statusCode === 503 || code.includes('PROVIDER') || code.includes('VENDOR')) return 'upstream_dependency';
  if (statusCode >= 500) return 'internal';
  if (code.includes('IDEMPOTENCY')) return 'idempotency';
  return 'validation';
}

function isRetryable(statusCode: number, code: string): boolean {
  return statusCode === 429 || statusCode === 503 || statusCode === 504 || code === 'AI_PLAN_INTERNAL_ERROR' || code === 'AI_PLAN_TIMEOUT' || code === 'AI_PLAN_RATE_LIMITED';
}

function isFastifyValidationError(error: unknown): error is FastifyValidationError {
  return typeof error === 'object'
    && error !== null
    && typeof (error as { statusCode?: unknown }).statusCode === 'number'
    && Array.isArray((error as { validation?: unknown }).validation);
}

function isClientError(error: unknown): error is ClientError {
  return typeof error === 'object'
    && error !== null
    && typeof (error as { statusCode?: unknown }).statusCode === 'number'
    && (error as { statusCode: number }).statusCode >= 400
    && (error as { statusCode: number }).statusCode < 500
    && typeof (error as { message?: unknown }).message === 'string';
}

function formatValidationDetails(issues: FastifyValidationIssue[]) {
  return issues.map((issue) => ({
    path: issue.instancePath || '/',
    message: issue.message ?? 'Invalid value.',
    keyword: issue.keyword ?? null,
    params: issue.params ?? {},
  }));
}

export default fp(errorHandlerPlugin, { name: 'error-handler-plugin' });
