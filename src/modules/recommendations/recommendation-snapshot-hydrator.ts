import type { DbClient } from '../../lib/db.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import type { MetadataCardView } from '../metadata/metadata-card.types.js';
import type { ClientHomeSection, ClientHomeSectionType, ClientMediaCard, ClientMediaType } from './client-home.types.js';

/**
 * Maps stored recommendation/home items into client-ready cards. Shared between
 * the recommendation output service and the homescreen resolver so both produce
 * identical `ClientMediaCard` shapes from the same raw stored section items.
 */
export class RecommendationSnapshotHydrator {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly metadataCardService = new MetadataCardService(),
  ) {}

  async hydrateSection(client: DbClient, value: unknown): Promise<ClientHomeSection | null> {
    const row = asRecord(value);
    const sectionType = readClientHomeSectionType(row.sectionType);
    const rawItems = Array.isArray(row.items) ? row.items : [];
    const id = typeof row.id === 'string' ? row.id : 'recommended';
    const title = typeof row.title === 'string' ? row.title : 'Recommended';
    const meta = asRecord(row.meta);

    const cards = (
      await Promise.all(rawItems.map((item) => this.hydrateCard(client, item)))
    ).filter((item): item is ClientMediaCard => item !== null);

    return {
      listKey: id,
      title,
      subtitle: readNullableText(row.subtitle),
      sectionType,
      items: cards,
      meta,
    };
  }

  async hydrateCard(client: DbClient, value: unknown): Promise<ClientMediaCard | null> {
    const row = asRecord(value);
    const itemId = readPublicItemId(row.itemId);
    if (!itemId) {
      return null;
    }
    const identity = await this.contentIdentityService.resolveMediaIdentity(client, assertPublicItemId(itemId));
    const card = await this.metadataCardService.buildCardView(client, identity);
    return card ? toClientMediaCard(card, row) : null;
  }
}

function toClientMediaCard(card: MetadataCardView, row: Record<string, unknown>): ClientMediaCard | null {
  if (!card.title) {
    return null;
  }
  return {
    itemId: card.itemId,
    mediaType: toClientMediaType(card.mediaType),
    title: card.title,
    subtitle: readNullableText(row.subtitle) ?? card.subtitle,
    overview: readNullableText(row.description) ?? card.overview ?? card.summary,
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
    parent: card.seriesItemId || card.seasonItemId || card.seasonNumber !== null || card.episodeNumber !== null
      ? {
          seriesItemId: card.seriesItemId ?? undefined,
          seasonItemId: card.seasonItemId ?? undefined,
          seasonNumber: card.seasonNumber,
          episodeNumber: card.episodeNumber,
        }
      : null,
  };
}

function toClientMediaType(mediaType: MetadataCardView['mediaType']): ClientMediaType {
  if (mediaType === 'show') {
    return 'tv';
  }
  return mediaType;
}

function readClientHomeSectionType(value: unknown): ClientHomeSectionType {
  return value === 'categoryTabs' || value === 'heroCarousel' || value === 'contentRail' || value === 'collectionRail'
    ? value
    : 'contentRail';
}

function readNullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPublicItemId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const itemId = value.trim();
  if (!itemId) {
    return null;
  }
  try {
    assertPublicItemId(itemId);
    return itemId;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
