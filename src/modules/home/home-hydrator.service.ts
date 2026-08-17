import type { DbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import { inferMediaIdentity, type MediaIdentity, type SupportedMediaType, type SupportedProvider } from '../identity/media-key.js';
import type { ClientHomeSection, ClientHomeSectionType, ClientMediaCard } from '../recommendations/client-home.types.js';
import type { MetadataCardView } from '../metadata/metadata-card.types.js';

type HomeListInput = {
  listKey: string;
  title: string;
  subtitle: string | null;
  sectionType: string;
  items: unknown[];
};

export class HomeHydrator {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly metadataCardService = new MetadataCardService(),
  ) {}

  /**
   * Hydrate every section in one pass. Identity resolution and card
   * construction are batched across ALL rows in ALL lists instead of being
   * awaited per section, collapsing the previous round-trip multiplier.
   *
   * Two row populations are handled separately:
   *  - Rows carrying an `itemId` (the unified-ingester path): resolved in
   *    one batched identity + one batched card-view call, with no
   *    `ensureContentIds` writes.
   *  - Rows carrying only provider refs (legacy fallback templates):
   *    resolved per-item because there is no canonical contentId yet.
   */
  async hydrateSections(client: DbClient, lists: HomeListInput[], locale: string | null): Promise<ClientHomeSection[]> {
    const sections: ClientHomeSection[] = [];
    if (!lists.length) return sections;

    type FlatRow = { listIndex: number; rowIndex: number; row: Record<string, unknown>; itemId: string | null };
    const flats: FlatRow[] = [];
    for (let listIndex = 0; listIndex < lists.length; listIndex++) {
      const rows = (lists[listIndex]!.items ?? []).map(asRecord);
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex]!;
        flats.push({ listIndex, rowIndex, row, itemId: readPublicItemId(row.itemId) });
      }
    }

    const batchRows: Array<FlatRow & { itemId: string }> = [];
    const fallbackRows: FlatRow[] = [];
    for (const flat of flats) {
      if (flat.itemId) batchRows.push(flat as FlatRow & { itemId: string });
      else fallbackRows.push(flat);
    }

    const cardByKey = new Map<string, ClientMediaCard | null>();
    const keyFor = (listIndex: number, rowIndex: number) => `${listIndex}:${rowIndex}`;

    if (batchRows.length) {
      const contentIds = batchRows.map((row) => assertPublicItemId(row.itemId));
      const identityByContentId = await this.contentIdentityService.resolveMediaIdentitiesBatched(client, contentIds);

      const orderedIdentities: Array<{ flat: FlatRow & { itemId: string }; identity: MediaIdentity }> = [];
      for (const row of batchRows) {
        const identity = identityByContentId.get(row.itemId);
        if (identity) orderedIdentities.push({ flat: row, identity });
      }

      if (orderedIdentities.length) {
        const views = await this.metadataCardService.buildCardViewsForIdentities(
          client,
          orderedIdentities.map((entry) => entry.identity),
          locale,
        );
        orderedIdentities.forEach((entry, i) => {
          const view = views[i];
          cardByKey.set(
            keyFor(entry.flat.listIndex, entry.flat.rowIndex),
            view && view.title ? this.toClientCard(view, entry.flat.row) : null,
          );
        });
      }
    }

    await Promise.all(fallbackRows.map(async (flat) => {
      const identity = await this.resolveIdentity(client, flat.row);
      if (!identity) {
        cardByKey.set(keyFor(flat.listIndex, flat.rowIndex), null);
        return;
      }
      const view = await this.metadataCardService.buildCardView(client, identity, locale);
      cardByKey.set(
        keyFor(flat.listIndex, flat.rowIndex),
        view && view.title ? this.toClientCard(view, flat.row) : null,
      );
    }));

    for (let listIndex = 0; listIndex < lists.length; listIndex++) {
      const list = lists[listIndex]!;
      const rows = (list.items ?? []).map(asRecord);
      const sectionCards: ClientMediaCard[] = [];
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const card = cardByKey.get(keyFor(listIndex, rowIndex));
        if (card) sectionCards.push(card);
      }
      if (sectionCards.length === 0) continue;
      sections.push({
        listKey: list.listKey,
        title: list.title,
        subtitle: list.subtitle,
        sectionType: readSectionType(list.sectionType),
        items: sectionCards,
        meta: {},
      });
    }

    return sections;
  }

  private toClientCard(card: MetadataCardView, row: Record<string, unknown>): ClientMediaCard {
    return {
      itemId: card.itemId,
      mediaType: toClientMediaType(card.mediaType ?? 'movie'),
      title: card.title ?? '',
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
      providerIds: card.externalIds
        ? {
            tmdb: card.externalIds.tmdb != null ? String(card.externalIds.tmdb) : null,
            tvdb: card.externalIds.tvdb != null ? String(card.externalIds.tvdb) : null,
            imdb: card.externalIds.imdb ?? null,
          }
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
