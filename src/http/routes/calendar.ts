import type { FastifyInstance } from 'fastify';
import { CalendarService } from '../../modules/calendar/calendar.service.js';

export async function registerCalendarRoutes(app: FastifyInstance): Promise<void> {
  const calendarService = new CalendarService();

  app.get('/v1/profiles/:profileId/calendar', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const params = request.params as { profileId: string };
    const profileId = params.profileId.trim();
    return calendarService.getCalendar(actor.appUserId, profileId);
  });
}
