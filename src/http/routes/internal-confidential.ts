import type { FastifyInstance } from 'fastify';
import { ConfidentialConfigService, parseConfidentialBundleRequest } from '../../modules/confidential/index.js';
import type { ConfidentialBundleContext } from '../../modules/confidential/types.js';
import { AiProviderResolver } from '../../modules/ai/ai-provider-resolver.js';
import { HttpError } from '../../lib/errors.js';

export interface InternalConfidentialRoutesDeps {
  confidentialConfigService: ConfidentialConfigService;
  aiProviderResolver?: AiProviderResolver;
}

export async function registerInternalConfidentialRoutes(
  app: FastifyInstance, 
  deps?: InternalConfidentialRoutesDeps
): Promise<void> {
  const confidentialConfigService = deps?.confidentialConfigService || new ConfidentialConfigService();
  const aiProviderResolver = deps?.aiProviderResolver || new AiProviderResolver();

  app.post('/internal/confidential/v1/accounts/:accountId/profiles/:profileId/config-bundle', async (request) => {
    const params = request.params as { accountId: string; profileId: string };
    const principal = await app.requireRecommenderAuth(request);
    const context: ConfidentialBundleContext = {
      authType: 'app',
      accountId: params.accountId,
      profileId: params.profileId,
      scopes: principal.scopes,
      actor: { type: 'app', principal },
    };

    try {
      return await confidentialConfigService.resolveBundle(
        context,
        parseConfidentialBundleRequest(request.body),
      );
    } catch (error) {
      throw confidentialConfigService.toPublicError(error);
    }
  });

  app.post('/internal/confidential/v1/accounts/:accountId/profiles/:profileId/ai-proxy/chat/completions', async (request, reply) => {
    const params = request.params as { accountId: string; profileId: string };
    const principal = await app.requireRecommenderAuth(request);
    const context: ConfidentialBundleContext = {
      authType: 'app',
      accountId: params.accountId,
      profileId: params.profileId,
      scopes: principal.scopes,
      actor: { type: 'app', principal },
    };
    const resources = [{
      kind: 'aiConfig' as const,
      version: 1 as const,
      purpose: 'recommendation-generation' as const,
    }];

    // Validate account/profile ownership and confidential config authorization.
    try {
      await confidentialConfigService.assertAccountProfileAccess(params.accountId, params.profileId);
      await confidentialConfigService.assertResourceAuthorization(context, resources);
      await confidentialConfigService.assertProfileEligibility(context, resources);
    } catch (error) {
      throw confidentialConfigService.toPublicError(error);
    }

    // Resolve provider credentials server-side
    let resolved;
    try {
      resolved = await aiProviderResolver.resolveForUser(params.accountId, 'insights');
    } catch (error) {
      request.log.warn({ error, accountId: params.accountId }, 'Failed to resolve AI provider');
      throw new HttpError(404, 'AI provider not configured for this account.');
    }

    // Build upstream URL
    const baseUrl = resolved.provider.endpointUrl.replace(/\/$/, '');
    const upstreamUrl = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;

    // Strip sensitive inbound headers and prepare upstream request
    const upstreamHeaders: Record<string, string> = {
      'Authorization': `Bearer ${resolved.apiKey}`,
      'Content-Type': 'application/json',
    };

    if (resolved.provider.httpReferer) {
      upstreamHeaders['HTTP-Referer'] = resolved.provider.httpReferer;
    }
    if (resolved.provider.title) {
      upstreamHeaders['X-Title'] = resolved.provider.title;
    }

    // Forward request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Return upstream response
      const contentType = upstreamResponse.headers.get('content-type') || 'application/json';
      const safeContentType = contentType.includes('application/json') || contentType.startsWith('text/')
        ? contentType
        : 'application/octet-stream';
      const body = await upstreamResponse.text();

      reply.status(upstreamResponse.status);
      reply.header('content-type', safeContentType);
      return reply.send(body);
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      
      if ((error as Error).name === 'AbortError') {
        throw new HttpError(504, 'AI provider request timeout.');
      }
      
      request.log.error({ error, upstreamUrl }, 'AI proxy upstream request failed');
      throw new HttpError(502, 'Failed to communicate with AI provider.');
    }
  });
}
