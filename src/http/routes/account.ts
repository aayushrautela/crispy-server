import type { FastifyInstance } from 'fastify';
import { AccountDeletionService } from '../../modules/users/account-deletion.service.js';

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  const accountDeletionService = new AccountDeletionService();

  app.delete('/v1/account', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    return {
      deleted: await accountDeletionService.deleteAccount({
        appUserId: actor.appUserId,
        authSubject: actor.authSubject,
      }),
    };
  });
}
