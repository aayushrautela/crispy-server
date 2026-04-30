import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { HttpError, inferHttpErrorCode } from '../../lib/errors.js';
import { AppAuthError } from '../../modules/apps/app-auth.errors.js';
import type { ApiErrorResponse } from '../contracts/shared.js';

const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    
    if (error instanceof AppAuthError) {
      void reply.status(error.statusCode).send(toErrorResponse(error.statusCode, error.code, error.message));
      return;
    }

    if (error instanceof HttpError) {
      void reply.status(error.statusCode).send(toErrorResponse(error.statusCode, error.code, error.message, error.details));
      return;
    }

    if (isFastifyValidationError(error)) {
      void reply.status(error.statusCode).send(
        toErrorResponse(error.statusCode, 'invalid_request', 'Request validation failed.', formatValidationDetails(error.validation)),
      );
      return;
    }

    if (isClientError(error)) {
      void reply.status(error.statusCode).send(
        toErrorResponse(error.statusCode, inferHttpErrorCode(error.statusCode, error.message), error.message),
      );
      return;
    }

    const message = 'Internal server error';

    void reply.status(500).send(toErrorResponse(500, inferHttpErrorCode(500, message), message));
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

function toErrorResponse(statusCode: number, code: string, message: string, details?: unknown): ApiErrorResponse {
  return details === undefined
    ? { code, message }
    : { code, message, details };
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
