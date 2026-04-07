import type { FastifyInstance } from 'fastify';
import { profileCalendarRouteSchema, profileThisWeekRouteSchema } from '../contracts/calendar.js';
import { HttpError } from '../../lib/errors.js';
import { CalendarService } from '../../modules/calendar/calendar.service.js';

export async function registerCalendarRoutes(app: FastifyInstance): Promise<void> {
  const calendarService = new CalendarService();

  app.get('/v1/profiles/:profileId/calendar', { schema: profileCalendarRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string };
    const profileId = getProfileIdFromParams(params);
    return calendarService.getCalendar(actor.appUserId, profileId);
  });

  app.get('/v1/profiles/:profileId/calendar/this-week', { schema: profileThisWeekRouteSchema }, async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId?: string };
    const profileId = getProfileIdFromParams(params);
    return calendarService.getThisWeek(actor.appUserId, profileId);
  });
}

function getProfileIdFromParams(params: { profileId?: string }): string {
  const profileId = params.profileId?.trim();
  if (!profileId) {
    throw new HttpError(400, 'Profile route is missing profileId param.');
  }
  return profileId;
}
