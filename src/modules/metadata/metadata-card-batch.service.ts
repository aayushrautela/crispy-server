import { withDbClient, type DbClient } from '../../lib/db.js';
import { parseMediaKey, type MediaIdentity } from '../identity/media-key.js';
import { MetadataCardService } from './metadata-card.service.js';
import { metadataCardToMediaItem, mediaItemToBaseItemDto } from './media-item.mapper.js';
import type { BaseItemDto } from './media-item.types.js';

type DbRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export type HydratedMediaCard = {
  mediaItem: BaseItemDto;
  metadataRefreshedAt: string | null;
};

export type MissingHydratedMediaCard = {
  mediaKey: string;
  reason: 'invalid_media_key' | 'not_found';
};

export type MetadataCardsBatchResult = {
  items: HydratedMediaCard[];
  missing: MissingHydratedMediaCard[];
};

export class MetadataCardBatchService {
  constructor(
    private readonly metadataCardService = new MetadataCardService(),
    private readonly runWithDb: DbRunner = withDbClient,
  ) {}

  async hydrate(input: { mediaKeys: string[]; language?: string | null }): Promise<MetadataCardsBatchResult> {
    const identities: MediaIdentity[] = [];
    const missing: MissingHydratedMediaCard[] = [];

    for (const mediaKey of input.mediaKeys) {
      try {
        identities.push(parseMediaKey(mediaKey));
      } catch {
        missing.push({ mediaKey, reason: 'invalid_media_key' });
      }
    }

    const items = await this.runWithDb(async (client) => {
      const cards = await this.metadataCardService.buildCardViews(client, identities, input.language ?? null);
      const metadataRefreshedAt = new Date().toISOString();

      return cards.map((card): HydratedMediaCard => ({
        mediaItem: mediaItemToBaseItemDto(metadataCardToMediaItem(card)),
        metadataRefreshedAt,
      }));
    });

    return { items, missing };
  }
}
