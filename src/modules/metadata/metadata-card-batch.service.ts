import { withDbClient, type DbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import { MetadataCardService } from './metadata-card.service.js';
import { toClientMediaCard } from './client-media-card.mapper.js';
import type { ClientMediaCard } from '../recommendations/client-home.types.js';

type DbRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export type HydratedMediaCard = {
  mediaItem: ClientMediaCard;
  metadataRefreshedAt: string | null;
};

export type MissingHydratedMediaCard = {
  itemId: string;
  reason: 'invalid_item_id' | 'not_found';
};

export type MetadataCardsBatchResult = {
  items: HydratedMediaCard[];
  missing: MissingHydratedMediaCard[];
};

export class MetadataCardBatchService {
  constructor(
    private readonly metadataCardService = new MetadataCardService(),
    private readonly runWithDb: DbRunner = withDbClient,
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async hydrate(input: { itemIds: string[]; language?: string | null }): Promise<MetadataCardsBatchResult> {
    const validItemIds: string[] = [];
    const missing: MissingHydratedMediaCard[] = [];

    for (const itemId of input.itemIds) {
      try {
        assertPublicItemId(itemId);
        validItemIds.push(itemId);
      } catch {
        missing.push({ itemId, reason: 'invalid_item_id' });
      }
    }

    const items = await this.runWithDb(async (client) => {
      const identities = await Promise.all(validItemIds.map(async (itemId) => ({
        itemId,
        identity: await this.contentIdentityService.resolveMediaIdentity(client, assertPublicItemId(itemId)),
      })));
      const cards = await this.metadataCardService.buildCardViews(client, identities.map(({ identity }) => identity), input.language ?? null);
      const metadataRefreshedAt = new Date().toISOString();

      return cards.flatMap((card, index): HydratedMediaCard[] => {
        if (!card) {
          return [];
        }
        const identity = identities[index];
        if (!identity) {
          return [];
        }
        return [{
          mediaItem: toClientMediaCard(card, { progress: null, itemId: identity.itemId }),
          metadataRefreshedAt,
        }];
      });
    });

    return { items, missing };
  }
}
