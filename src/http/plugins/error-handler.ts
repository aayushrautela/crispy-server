import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { HttpError } from '../../lib/errors.js';

const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    if (error instanceof HttpError) {
      void reply.status(error.statusCode).send({
        error: error.message,
        details: error.details,
      });
      return;
    }

    void reply.status(500).send({
      error: 'Internal server error',
    });
  });
};

export default fp(errorHandlerPlugin, { name: 'error-handler-plugin' });
