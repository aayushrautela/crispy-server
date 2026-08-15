import type { FastifyInstance } from 'fastify';
import { accountBootstrapRouteSchema } from '../contracts/account.js';
import { success } from '../response.js';
import {
  normalizeRequiredName,
  normalizeRequiredProfileLanguage,
  normalizeOptionalProfileRegion,
  normalizeRequiredAvatar,
  type ProfileLocalService,
} from '../../modules/profiles/profile-local.service.js';

/**
 * POST /v1/account/bootstrap
 *
 * Creates the account's first (primary) profile during onboarding. This is the
 * single, guided step that turns a freshly-signed-up account into a usable one:
 * the profile name is mandatory, and the resulting profile is always the
 * account admin and never a kids profile (enforced server-side in
 * ProfileLocalService.bootstrapPrimaryProfile).
 *
 * Idempotent: a retried or repeated call returns the existing primary profile
 * instead of creating a duplicate, so the client may call it freely during
 * onboarding without guarding against double-submit.
 */
export async function registerAccountBootstrapRoutes(
  app: FastifyInstance,
  opts: { profileService: ProfileLocalService },
): Promise<void> {
  const profileService = opts.profileService;

  app.post('/v1/account/bootstrap', { schema: accountBootstrapRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserSessionActor(request) as { authSubject: string };

    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = normalizeRequiredName(body.name);
    const interfaceLanguage = normalizeRequiredProfileLanguage(body.interfaceLanguage);
    const region = normalizeOptionalProfileRegion(body.region);
    const avatarUrl = normalizeRequiredAvatar(body.avatarUrl);

    const { created, profile } = await profileService.bootstrapPrimaryProfile(actor.authSubject, {
      name,
      interfaceLanguage,
      region,
      avatarUrl,
    });

    if (created) {
      profileService.notifyProfileCreated(actor.authSubject, profile.id);
    }

    return success({ profile, created });
  });
}
