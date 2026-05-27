import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';

export type AuthAdminUser = {
  id: string;
  email: string | null;
};

export class ExternalAuthAdminService {
  isConfigured(): boolean {
    return true;
  }

  async findUserByEmail(email: string): Promise<AuthAdminUser | null> {
    

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

  async createSessionTokens(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await fetch(`${env.authAdminUrl.replace(/\/$/, '')}/admin/users/${encodeURIComponent(userId)}/tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.authAdminApiKey}`,
        apikey: env.authAdminApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'refresh_token' }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new HttpError(502, 'Failed to generate auth session tokens.', {
        userId,
        providerStatus: response.status,
        responseBody: body.slice(0, 500),
      });
    }

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
    };

    return {
      accessToken: data.access_token ?? '',
      refreshToken: data.refresh_token ?? '',
    };
  }

  async deleteUser(authSubject: string): Promise<boolean> {
    

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
