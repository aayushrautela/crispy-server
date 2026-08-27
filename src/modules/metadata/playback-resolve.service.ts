import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import { buildMetadataCardView } from './metadata-card.builders.js';
import type { TmdbSeasonRecord } from './providers/tmdb.types.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId, encodePublicItemId } from '../identity/public-item-id.js';
import { MetadataDetailCoreService } from './metadata-detail-core.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { ClientMediaCard } from '../recommendations/client-home.types.js';
import { toClientMediaCard } from './client-media-card.mapper.js';
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
      let show: ClientMediaCard | null = null;
      let season: ClientMediaCard | null = null;

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
            const seasonIdentity = inferMediaIdentity({
              mediaType: 'season',
              provider: 'tmdb',
              providerId: String(identity.showTmdbId),
              tmdbId: identity.showTmdbId,
              showTmdbId: identity.showTmdbId,
              seasonNumber: identity.seasonNumber,
              contentId: seasonId,
            });
            const rawSeasons = Array.isArray(showTitle.raw?.seasons) ? showTitle.raw.seasons : [];
            const rawSeason = rawSeasons.find(
              (s: unknown): s is Record<string, unknown> => typeof s === 'object' && s !== null && (s as Record<string, unknown>).season_number === identity.seasonNumber,
            );
            const currentSeason: TmdbSeasonRecord | null = rawSeason
              ? {
                  showTmdbId: identity.showTmdbId,
                  seasonNumber: identity.seasonNumber,
                  name: typeof rawSeason.name === 'string' ? rawSeason.name : null,
                  overview: typeof rawSeason.overview === 'string' ? rawSeason.overview : null,
                  airDate: typeof rawSeason.air_date === 'string' ? rawSeason.air_date : null,
                  posterPath: typeof rawSeason.poster_path === 'string' ? rawSeason.poster_path : null,
                  episodeCount: typeof rawSeason.episode_count === 'number' ? rawSeason.episode_count : null,
                  raw: rawSeason,
                  fetchedAt: showTitle.fetchedAt,
                  expiresAt: showTitle.expiresAt,
                }
              : null;
            const seasonView = buildMetadataCardView({
              identity: seasonIdentity,
              itemId: encodePublicItemId(seasonId),
              seriesItemId: show.itemId,
              seasonItemId: null,
              title: showTitle,
              currentSeason,
              language: input.language ?? null,
            });
            season = toClientMediaCard(seasonView, { progress: null });
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
