export interface AuthenticatedIntegrationPrincipal {
  kind: 'integration_api_key';
  accountId: string;
  apiKeyId: string;
  keyPrefix: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    integration?: AuthenticatedIntegrationPrincipal;
  }
}
