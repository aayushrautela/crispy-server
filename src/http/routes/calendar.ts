import type { FastifyInstance } from 'fastify';
import { CalendarService } from '../../modules/calendar/calendar.service.js';

export async function registerCalendarRoutes(app: FastifyInstance): Promise<void> {
  const calendarService = new CalendarService();

  app.get('/v1/calendar', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request) as { appUserId: string };
    const profileId = app.requireProfileId(request);
    return calendarService.getCalendar(actor.appUserId, profileId);
  });
}
