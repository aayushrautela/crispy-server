import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';

export type AuthAdminUser = {
  id: string;
  email: string | null;
};

export class ExternalAuthAdminService {
  isConfigured(): boolean {
    return Boolean(env.authAdminUrl && env.authAdminApiKey);
  }

  async findUserByEmail(email: string): Promise<AuthAdminUser | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const baseUrl = env.authAdminUrl.replace(/\/$/, '');
    const url = `${baseUrl}/admin/users?filter=${encodeURIComponent(email)}&page=1&per_page=10`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.authAdminApiKey}`,
        apikey: env.authAdminApiKey,
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new HttpError(502, 'Failed to lookup user in external auth.', {
        email,
        providerStatus: response.status,
        responseBody: body.slice(0, 500),
      });
    }

    const data = (await response.json()) as {
      users?: Array<{ id: string; email?: string | null }>;
    };
    const users = data?.users ?? [];
    const match = users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );

    return match
      ? { id: match.id, email: match.email ?? null }
      : null;
  }

  async deleteUser(authSubject: string): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    const response = await fetch(`${env.authAdminUrl.replace(/\/$/, '')}/admin/users/${encodeURIComponent(authSubject)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${env.authAdminApiKey}`,
        apikey: env.authAdminApiKey,
      },
    });

    if (response.status === 404) {
      return false;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new HttpError(502, 'Failed to delete external auth user.', {
        authSubject,
        providerStatus: response.status,
        responseBody: body.slice(0, 500),
      });
    }

    return true;
  }
}
