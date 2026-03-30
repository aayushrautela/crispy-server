import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { showTmdbIdForIdentity } from '../identity/media-key.js';
import { MetadataCardService } from './metadata-card.service.js';
import { ProviderMetadataService } from './provider-metadata.service.js';
import { extractNextEpisodeToAir } from './providers/tmdb-episode-helpers.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';

export type WatchProjection = {
  title: string | null;
  subtitle: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
};

export class MetadataProjectionService {
  constructor(
    private readonly metadataCardService = new MetadataCardService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
  ) {}

  async buildWatchProjection(client: DbClient, identity: MediaIdentity): Promise<WatchProjection> {
    const media = await this.metadataCardService.buildCardView(client, identity);
    return {
      title: media.title,
      subtitle: media.subtitle,
      posterUrl: media.artwork.posterUrl,
      backdropUrl: media.artwork.backdropUrl,
    };
  }

  async warmCache(client: DbClient, identity: MediaIdentity): Promise<void> {
    if (identity.mediaType === 'movie' && identity.provider === 'tmdb' && identity.tmdbId) {
      await this.tmdbCacheService.getTitle(client, 'movie', identity.tmdbId);
    }
  }

  async resolveNextEpisodeAirDate(client: DbClient, identity: MediaIdentity): Promise<string | null> {
    if (identity.provider === 'tmdb') {
      const showTmdbId = showTmdbIdForIdentity(identity);
      if (!showTmdbId) {
        return null;
      }

      const title = await this.tmdbCacheService.getTitle(client, 'tv', showTmdbId);
      return extractNextEpisodeToAir(title)?.airDate ?? null;
    }

    const context = await this.providerMetadataService.loadIdentityContext(client, identity);
    return context?.nextEpisode?.airDate ?? null;
  }
}
