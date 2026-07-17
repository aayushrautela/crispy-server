import type { FastifyInstance } from 'fastify';
import { profileCalendarRouteSchema, profileThisWeekRouteSchema } from '../contracts/calendar.js';
import { HttpError } from '../../lib/errors.js';
import { CalendarService } from '../../modules/calendar/calendar.service.js';
import { success } from '../response.js';
import { requireProfileUnlock } from '../plugins/profile-unlock-guard.js';

export interface CalendarRoutesDeps {
  profilePinService?: {
    hasPin(profileId: string): Promise<boolean>;
  };
}

export async function registerCalendarRoutes(
  app: FastifyInstance,
  deps: CalendarRoutesDeps = {}
): Promise<void> {
  const calendarService = new CalendarService();
  const { profilePinService } = deps;

  async function assertProfileUnlocked(request: import('fastify').FastifyRequest, profileId: string) {
    if (!profilePinService) return;
    await requireProfileUnlock(request, profileId, { profilePinService });
  }

  app.get('/v1/profiles/:profileId/calendar', { schema: profileCalendarRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string };
    const profileId = getProfileIdFromParams(params);
    await assertProfileUnlocked(request, profileId);
    return success(await calendarService.getCalendar(actor.appUserId, profileId), request);
  });

  app.get('/v1/profiles/:profileId/calendar/this-week', { schema: profileThisWeekRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string };
    const profileId = getProfileIdFromParams(params);
    await assertProfileUnlocked(request, profileId);
    return success(await calendarService.getThisWeek(actor.appUserId, profileId), request);
  });
}

function getProfileIdFromParams(params: { profileId?: string }): string {
  const profileId = params.profileId?.trim();
  if (!profileId) {
    throw new HttpError(400, 'Profile route is missing profileId param.');
  }
  return profileId;
}
