import type { DbClient } from '../../../lib/db.js';
import { HttpError } from '../../../lib/errors.js';
import { TmdbClient } from '../../metadata/providers/tmdb.client.js';
import { ContentIdentityService } from '../../identity/content-identity.service.js';
import { MetadataCardService } from '../../metadata/metadata-card.service.js';
import { inferMediaIdentity, type MediaIdentity } from '../../identity/media-key.js';
import type { ClientHomeSection, ClientHomeSectionType, ClientMediaCard, ClientMediaType } from '../../recommendations/client-home.types.js';
import type { SectionProviderContext } from '../homescreen.types.js';

export type TmdbRawItem = {
  id?: unknown;
  media_type?: unknown;
  title?: unknown;
  name?: unknown;
  release_date?: unknown;
  first_air_date?: unknown;
  overview?: unknown;
  poster_path?: unknown;
  backdrop_path?: unknown;
  vote_average?: unknown;
  popularity?: unknown;
  genre_ids?: unknown;
};

export type TmdbSectionBuilderOptions = {
  key: string;
  title: string;
  subtitle?: string | null;
  sectionType: ClientHomeSectionType;
  maxItems: number;
  /** TMDB path relative to base, e.g. "/trending/all/day". */
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Override how items are ordered/sliced. */
  pick?: (items: TmdbRawItem[], ctx: SectionProviderContext) => TmdbRawItem[];
};

function toClientMediaType(mediaType: 'movie' | 'show'): ClientMediaType {
  return mediaType === 'show' ? 'tv' : 'movie';
}

/**
 * Shared TMDB-backed section builder. Fetches a TMDB list endpoint, resolves
 * each item to a canonical content identity, and produces a hydrated
 * ClientHomeSection. The resolved cards are cached at the snapshot layer, so
 * the identity lookups here run at most once per configured refresh interval.
 */
export class TmdbSectionBuilder {
  constructor(
    private readonly tmdbClient = new TmdbClient(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly metadataCardService = new MetadataCardService(),
  ) {}

  async build(opts: TmdbSectionBuilderOptions, ctx: SectionProviderContext, client: DbClient): Promise<ClientHomeSection[]> {
    const locale = ctx.locale || 'en-US';
    const response = await this.tmdbClient.request(opts.path, {
      language: locale,
      region: ctx.region ?? undefined,
      ...opts.query,
    });

    const results = Array.isArray(response.results) ? (response.results as TmdbRawItem[]) : [];
    const wanted = (opts.pick ? opts.pick(results, ctx) : results).slice(0, opts.maxItems);

    const cards = await this.resolveCards(client, ctx, wanted);
    return [{
      listKey: opts.key,
      title: opts.title,
      subtitle: opts.subtitle ?? null,
      sectionType: opts.sectionType,
      items: cards,
      meta: {},
    }];
  }

  private async resolveCards(client: DbClient, ctx: SectionProviderContext, items: TmdbRawItem[]): Promise<ClientMediaCard[]> {
    const identities: Array<MediaIdentity | null> = items.map((item) => {
      const mediaType = item.media_type === 'movie' ? 'movie' : item.media_type === 'tv' ? 'show' : null;
      const tmdbId = typeof item.id === 'number' ? item.id : null;
      if (!mediaType || tmdbId === null) {
        return null;
      }
      return inferMediaIdentity({ mediaType, provider: 'tmdb', providerId: tmdbId, tmdbId });
    });

    const contentIds = await this.contentIdentityService.ensureContentIds(
      client,
      identities.filter((identity): identity is MediaIdentity => identity !== null),
    );

    const cards: ClientMediaCard[] = [];
    for (const identity of identities) {
      if (!identity) {
        continue;
      }
      const key = identity.mediaKey;
      const contentId = key ? contentIds.get(key) : undefined;
      if (!contentId) {
        continue;
      }
      const resolved = await this.contentIdentityService.resolveMediaIdentity(client, contentId);
      const card = await this.metadataCardService.buildCardView(client, resolved, ctx.locale);
      if (card && card.title) {
        cards.push({
          itemId: card.itemId,
          mediaType: toClientMediaType(card.mediaType === 'show' ? 'show' : 'movie'),
          title: card.title,
          subtitle: card.subtitle ?? null,
          overview: card.overview ?? null,
          year: card.releaseYear,
          releaseDate: card.releaseDate,
          rating: card.rating,
          maturityRating: card.maturityRating,
          genres: card.genres,
          runtimeSeconds: typeof card.runtimeMinutes === 'number' ? card.runtimeMinutes * 60 : null,
          images: {
            poster: card.images.poster,
            backdrop: card.images.backdrop,
            logo: card.images.logo,
            still: card.images.still,
          },
          progress: null,
          parent: null,
        });
      }
    }
    return cards;
  }
}
