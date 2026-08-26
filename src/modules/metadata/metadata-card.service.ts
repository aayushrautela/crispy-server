import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService, type EpisodeParentItemIds } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import type { MetadataCardView } from './metadata-card.types.js';
import { buildMetadataCardView } from './metadata-card.builders.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';

export class MetadataCardService {
  constructor(
    private readonly titleSourceService = new MetadataTitleSourceService(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async buildCardView(client: DbClient, identity: MediaIdentity, language?: string | null): Promise<MetadataCardView> {
    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);
    const itemId = encodePublicItemId(identity.contentId ?? await this.contentIdentityService.ensureContentId(client, identity));
    const parentIds = identity.mediaType === 'episode'
      ? await this.contentIdentityService.resolveParentItemIdsForEpisode(client, itemId)
      : { seriesItemId: null, seasonItemId: null };

    return buildMetadataCardView({
      identity,
      itemId,
      seriesItemId: parentIds.seriesItemId,
      seasonItemId: parentIds.seasonItemId,
      title: source.tmdbTitle,
      currentEpisode: source.tmdbCurrentEpisode,
      currentSeason: source.tmdbCurrentSeason,
      language: language ?? null,
    });
  }

  async buildCardViews(client: DbClient, identities: MediaIdentity[], language?: string | null): Promise<(MetadataCardView | null)[]> {
    if (!identities.length) {
      return [];
    }
    const normalizedLanguage = language ?? null;

    const titleSources = await this.titleSourceService.loadTitleSources(client, identities, normalizedLanguage);
    const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);

    const episodeItemIds: string[] = [];
    for (const identity of identities) {
      if (identity.mediaType === 'episode') {
        const contentId = contentIds.get(identity.mediaKey);
        if (contentId) {
          episodeItemIds.push(encodePublicItemId(contentId));
        }
      }
    }
    const parentIds = episodeItemIds.length
      ? await this.contentIdentityService.resolveParentItemIdsForEpisodes(client, episodeItemIds)
      : new Map<string, EpisodeParentItemIds>();

    return identities.map((identity) => {
      const contentId = contentIds.get(identity.mediaKey);
      if (!contentId) {
        return null;
      }

      const source = titleSources.get(identity.mediaKey);
      const itemId = encodePublicItemId(contentId);
      const parents = identity.mediaType === 'episode'
        ? (parentIds.get(itemId) ?? { seriesItemId: null, seasonItemId: null })
        : { seriesItemId: null, seasonItemId: null };

      return buildMetadataCardView({
        identity,
        itemId,
        seriesItemId: parents.seriesItemId,
        seasonItemId: parents.seasonItemId,
        title: source?.tmdbTitle ?? null,
        currentEpisode: source?.tmdbCurrentEpisode ?? null,
        currentSeason: source?.tmdbCurrentSeason ?? null,
        language: normalizedLanguage,
      });
    });
  }

  /**
   * Same shape as {@link buildCardViews}, but for callers that already hold
   * the canonical `contentId` for every identity and don't need the
   * identity-service upsert path. Used by read-only surfaces (home, admin
   * recommendations preview) so a GET doesn't churn `content_provider_refs`
   * on every request.
   *
   * Identities missing a `contentId` resolve to `null` in the returned array
   * at the same index — the caller is responsible for either skipping them
   * or running them through `ensureContentId` first.
   */
  async buildCardViewsForIdentities(client: DbClient, identities: MediaIdentity[], language?: string | null): Promise<(MetadataCardView | null)[]> {
    if (!identities.length) {
      return [];
    }
    const normalizedLanguage = language ?? null;

    const resolvedIndexes: number[] = [];
    const resolvedIdentities: MediaIdentity[] = [];
    for (let i = 0; i < identities.length; i++) {
      const identity = identities[i]!;
      if (identity.contentId) {
        resolvedIndexes.push(i);
        resolvedIdentities.push(identity);
      }
    }

    const views: (MetadataCardView | null)[] = new Array(identities.length).fill(null);
    if (!resolvedIdentities.length) {
      return views;
    }

    const titleSources = await this.titleSourceService.loadTitleSources(client, resolvedIdentities, normalizedLanguage);

    const episodeItemIds: string[] = [];
    for (const identity of resolvedIdentities) {
      if (identity.mediaType === 'episode' && identity.contentId) {
        episodeItemIds.push(encodePublicItemId(identity.contentId));
      }
    }
    const parentIds = episodeItemIds.length
      ? await this.contentIdentityService.resolveParentItemIdsForEpisodes(client, episodeItemIds)
      : new Map<string, EpisodeParentItemIds>();

    resolvedIdentities.forEach((identity, i) => {
      const originalIndex = resolvedIndexes[i]!;
      const itemId = encodePublicItemId(identity.contentId!);
      const source = titleSources.get(identity.mediaKey);
      const parents = identity.mediaType === 'episode'
        ? (parentIds.get(itemId) ?? { seriesItemId: null, seasonItemId: null })
        : { seriesItemId: null, seasonItemId: null };
      views[originalIndex] = buildMetadataCardView({
        identity,
        itemId,
        seriesItemId: parents.seriesItemId,
        seasonItemId: parents.seasonItemId,
        title: source?.tmdbTitle ?? null,
        currentEpisode: source?.tmdbCurrentEpisode ?? null,
        language: normalizedLanguage,
      });
    });

    return views;
  }
}
