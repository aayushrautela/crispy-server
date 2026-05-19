import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import { buildSeasonBaseItemDto } from './metadata-detail.builders.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId, encodePublicItemId } from '../identity/public-item-id.js';
import { MetadataDetailCoreService } from './metadata-detail-core.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { BaseItemDto } from './media-item.types.js';
import type { PlaybackResolveResponse } from './metadata-detail.types.js';

export type ResolveMetadataInput = {
  itemId: string;
  language?: string | null;
};

export class PlaybackResolveService {
  constructor(
    private readonly metadataDetailCoreService = new MetadataDetailCoreService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async resolvePlayback(input: ResolveMetadataInput): Promise<PlaybackResolveResponse> {
    return withDbClient(async (client) => {
      const identity = await this.resolveIdentity(client, input);
      const item = await this.metadataDetailCoreService.buildMetadataView(client, identity, input.language ?? null);
      let show: BaseItemDto | null = null;
      let season: BaseItemDto | null = null;

      if (identity.mediaType === 'episode' && identity.showTmdbId) {
        const showIdentity = inferMediaIdentity({
          mediaType: 'show',
          provider: 'tmdb',
          providerId: identity.showTmdbId,
          tmdbId: identity.showTmdbId,
        });
        show = await this.metadataDetailCoreService.buildMetadataView(client, showIdentity, input.language ?? null);

        if (identity.seasonNumber !== null) {
          const showTitle = await this.tmdbCacheService.getTitle(client, 'tv', identity.showTmdbId, input.language ?? null);
          if (showTitle) {
            const seasonId = await this.contentIdentityService.ensureSeasonContentId(client, {
              parentMediaType: 'show',
              provider: 'tmdb',
              parentProviderId: identity.showTmdbId,
              seasonNumber: identity.seasonNumber,
            });
            season = buildSeasonBaseItemDto(showTitle, identity.seasonNumber, encodePublicItemId(seasonId), item.SeriesId ?? show.Id);
          }
        }
      }

      return {
        Item: item,
        Show: show,
        Season: season,
      };
    });
  }

  private async resolveIdentity(client: DbClient, input: ResolveMetadataInput): Promise<MediaIdentity> {
    const identity = await this.contentIdentityService.resolveMediaIdentity(client, assertPublicItemId(input.itemId));
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'show' && identity.mediaType !== 'episode') {
      throw new HttpError(400, 'Invalid playable item id.');
    }
    return identity;
  }
}
