import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { renderAdminLoginPage, renderAdminPage } from '../admin-ui/page.js';

export async function registerAdminUiRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, function (_request, body, done) {
    try {
      const params = new URLSearchParams(body as string);
      const parsed: Record<string, string | string[]> = {};
      for (const [key, value] of params.entries()) {
        const existing = parsed[key];
        if (existing === undefined) {
          parsed[key] = value;
          continue;
        }
        parsed[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      }
      done(null, parsed);
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.get('/admin/login', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('color-scheme', 'dark');

    if (app.getAdminUiSession(request)) {
      return reply.redirect('/admin', 303);
    }

    const unavailableReason = app.getAdminUiConfigurationError();
    reply.type('text/html; charset=utf-8');
    reply.code(unavailableReason ? 503 : 200);
    return renderAdminLoginPage({
      formToken: unavailableReason ? '' : app.createAdminUiFormToken('login'),
      unavailableReason,
    });
  });

  app.post('/admin/login', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('color-scheme', 'dark');

    if (app.getAdminUiSession(request)) {
      return reply.redirect('/admin', 303);
    }

    const unavailableReason = app.getAdminUiConfigurationError();
    if (unavailableReason) {
      reply.code(503);
      reply.type('text/html; charset=utf-8');
      return renderAdminLoginPage({ formToken: '', unavailableReason });
    }

    const body = asRecord(request.body);
    const formToken = readRequiredString(body.formToken, 'formToken');
    const username = readRequiredString(body.username, 'username');
    const password = readRequiredString(body.password, 'password');

    try {
      app.verifyAdminUiFormToken(request, formToken, 'login');
      app.verifyAdminUiCredentials(username, password);
      app.issueAdminUiSession(reply);
      return reply.redirect('/admin', 303);
    } catch (error) {
      const nextToken = app.createAdminUiFormToken('login');
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const message = statusCode === 401
        ? 'Invalid username or password.'
        : statusCode === 403
          ? 'The login form expired. Reload the page and try again.'
          : 'Admin login is unavailable right now.';
      reply.code(statusCode);
      reply.type('text/html; charset=utf-8');
      return renderAdminLoginPage({ formToken: nextToken, error: message });
    }
  });

  app.post('/admin/logout', async (request, reply) => {
    reply.header('cache-control', 'no-store');

    const body = asRecord(request.body);
    const formToken = readRequiredString(body.csrfToken, 'csrfToken');
    const session = await app.requireAdminUi(request);
    app.verifyAdminUiFormToken(request, formToken, 'logout', session);
    app.clearAdminUiSession(reply);
    return reply.redirect('/admin/login', 303);
  });

  app.get('/admin', async (request, reply) => {
    const session = app.getAdminUiSession(request);
    if (!session) {
      return reply.redirect('/admin/login', 303);
    }
    reply.header('cache-control', 'no-store');
    reply.header('color-scheme', 'dark');
    reply.type('text/html; charset=utf-8');
    return renderAdminPage({
      csrfToken: session.csrfToken,
      logoutToken: app.createAdminUiFormToken('logout', session),
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required.`);
  }
  return value.trim();
}
