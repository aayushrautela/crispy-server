import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSupportedAvatar, avatarFileName, SUPPORTED_AVATARS, type AvatarId } from '../../modules/profiles/avatars.js';
import { success } from '../response.js';

const AVATAR_CONTENT_TYPE = 'image/png';

interface AvatarListItem {
  id: AvatarId;
  url: string;
}

export async function registerAvatarRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/avatars', async (request) => {
    const baseUrl = `${request.protocol}://${request.hostname}`;
    const avatars: AvatarListItem[] = SUPPORTED_AVATARS.map((id) => ({
      id,
      url: `${baseUrl}/v1/avatars/${id}`,
    }));
    return success({ avatars }, request);
  });

  app.get('/v1/avatars/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isSupportedAvatar(id)) {
      return reply.code(404).send({ error: 'not_found', message: 'Avatar not found.' });
    }

    let data: Buffer;
    try {
      data = await readFile(join(process.cwd(), 'assets', 'avatars', avatarFileName(id)));
    } catch {
      return reply.code(404).send({ error: 'not_found', message: 'Avatar not found.' });
    }

    reply.header('content-type', AVATAR_CONTENT_TYPE);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(data);
  });
}