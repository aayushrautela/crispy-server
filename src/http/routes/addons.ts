import type { FastifyInstance } from 'fastify';
import {
  addonCreateRouteSchema,
  addonDeleteRouteSchema,
  addonListRouteSchema,
} from '../contracts/addon.js';
import { AddonService } from '../../modules/users/addon.service.js';
import { success } from '../response.js';
import { createRequireAdminProfile, type AdminProfileLookup } from '../auth-helpers.js';
import { ProfileLocalService } from '../../modules/profiles/profile-local.service.js';

export async function registerAddonRoutes(
  app: FastifyInstance,
  opts: { addonService: AddonService; adminProfileLookup?: AdminProfileLookup },
): Promise<void> {
  const addonService = opts.addonService;
  const requireAdminProfile = opts.adminProfileLookup
    ? createRequireAdminProfile(opts.adminProfileLookup)
    : createRequireAdminProfile(async (profileId, authSubject) => {
        const profileService = new ProfileLocalService();
        const profile = await profileService.requireOwnedProfile(authSubject, profileId);
        return { id: profile.id, accountId: authSubject, isAdmin: profile.isAdmin, hasPin: profile.hasPin };
      });

  app.get('/v1/account/addons', { schema: addonListRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const { addons } = await addonService.listAddons(actor.authSubject);
    return success({ addons }, request);
  });

  app.post('/v1/account/addons', { schema: addonCreateRouteSchema }, async (request) => {
    await app.requireAuth(request);
    await requireAdminProfile(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const body = (request.body ?? {}) as { manifestUrl?: string };
    const addon = await addonService.addAddon(actor.authSubject, body.manifestUrl ?? '');
    return success({ addon }, request);
  });

  app.delete('/v1/account/addons/:addonId', { schema: addonDeleteRouteSchema }, async (request) => {
    await app.requireAuth(request);
    await requireAdminProfile(request);
    const actor = app.requireUserActor(request) as { authSubject: string };
    const params = request.params as { addonId: string };
    const { deleted } = await addonService.removeAddon(actor.authSubject, params.addonId);
    return success({ deleted }, request);
  });
}
