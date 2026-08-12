import type { DbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import { inferMediaIdentity, type MediaIdentity, type SupportedMediaType, type SupportedProvider } from '../identity/media-key.js';
import type { ClientHomeSection, ClientHomeSectionType, ClientMediaCard } from '../recommendations/client-home.types.js';

export class HomeHydrator {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly metadataCardService = new MetadataCardService(),
  ) {}

  async hydrateSections(client: DbClient, lists: Array<{
    listKey: string;
    title: string;
    subtitle: string | null;
    sectionType: string;
    items: unknown[];
  }>, locale: string | null): Promise<ClientHomeSection[]> {
    const sections: ClientHomeSection[] = [];
    for (const list of lists) {
      const section = await this.hydrateSection(client, list, locale);
      if (section) sections.push(section);
    }
    return sections;
  }

  private async hydrateSection(client: DbClient, list: {
    listKey: string;
    title: string;
    subtitle: string | null;
    sectionType: string;
    items: unknown[];
  }, locale: string | null): Promise<ClientHomeSection | null> {
    const sectionType = readSectionType(list.sectionType);
    const cards = (
      await Promise.all((list.items ?? []).map((item) => this.hydrateCard(client, item, locale)))
    ).filter((card): card is ClientMediaCard => card !== null);

    if (cards.length === 0) {
      return null;
    }

    return {
      listKey: list.listKey,
      title: list.title,
      subtitle: list.subtitle,
      sectionType,
      items: cards,
      meta: {},
    };
  }

  private async hydrateCard(client: DbClient, value: unknown, locale: string | null): Promise<ClientMediaCard | null> {
    const row = asRecord(value);
    const identity = await this.resolveIdentity(client, row);
    if (!identity) return null;
    const card = await this.metadataCardService.buildCardView(client, identity, locale);
    if (!card.title) return null;
    return {
      itemId: card.itemId,
      mediaType: toClientMediaType(card.mediaType),
      title: card.title,
      overview: readNullableText(row.description) ?? card.tagline ?? card.overview ?? card.summary,
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
      trailerUrl: card.trailerUrl,
      progress: null,
      parent: card.seriesItemId || card.seasonItemId || card.seasonNumber !== null || card.episodeNumber !== null
        ? {
            seriesItemId: card.seriesItemId ?? undefined,
            seasonItemId: card.seasonItemId ?? undefined,
            seasonNumber: card.seasonNumber,
            episodeNumber: card.episodeNumber,
          }
        : null,
      providerIds: card.tmdbId !== null || card.showTmdbId !== null
        ? { tmdb: card.tmdbId !== null ? String(card.tmdbId) : null, tvdb: null, imdb: null }
        : null,
    };
  }

  /**
   * Resolve a stored item into a MediaIdentity. Items written by the unified
   * ingester carry a resolved `itemId`; fallback templates only carry
   * provider refs and are resolved on the fly.
   */
  private async resolveIdentity(client: DbClient, row: Record<string, unknown>): Promise<MediaIdentity | null> {
    const itemId = readPublicItemId(row.itemId);
    if (itemId) {
      return this.contentIdentityService.resolveMediaIdentity(client, assertPublicItemId(itemId));
    }
    const provider = row.provider;
    const providerId = row.providerId;
    const mediaType = row.mediaType;
    if (typeof provider !== 'string' || typeof providerId !== 'string' || typeof mediaType !== 'string') {
      return null;
    }
    const supportedProvider: SupportedProvider = provider === 'tvdb' || provider === 'imdb' || provider === 'kitsu' ? provider : 'tmdb';
    const supportedType: SupportedMediaType = mediaType === 'tv' ? 'show' : 'movie';
    return inferMediaIdentity({
      mediaType: supportedType,
      provider: supportedProvider,
      providerId,
      tmdbId: supportedProvider === 'tmdb' ? Number(providerId) : null,
    });
  }
}

function toClientMediaType(mediaType: string): ClientMediaCard['mediaType'] {
  if (mediaType === 'show') return 'tv';
  if (mediaType === 'movie' || mediaType === 'season' || mediaType === 'episode') return mediaType;
  return 'movie';
}

function readSectionType(value: unknown): ClientHomeSectionType {
  return value === 'categoryTabs' || value === 'heroCarousel' || value === 'contentRail' || value === 'collectionRail'
    ? value
    : 'contentRail';
}

function readNullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPublicItemId(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
