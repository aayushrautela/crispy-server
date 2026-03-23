import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';

export class ExternalAuthAdminService {
  isConfigured(): boolean {
    return Boolean(env.authAdminUrl && env.authAdminToken);
  }

  async deleteUser(authSubject: string): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    const response = await fetch(`${env.authAdminUrl.replace(/\/$/, '')}/admin/users/${encodeURIComponent(authSubject)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${env.authAdminToken}`,
        apikey: env.authAdminToken,
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
