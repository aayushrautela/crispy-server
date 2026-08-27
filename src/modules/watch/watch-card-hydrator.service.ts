import type { DbClient } from '../../lib/db.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { toClientMediaCard } from '../metadata/client-media-card.mapper.js';
import type { MediaIdentity } from '../identity/media-key.js';
import type { ClientProgress } from '../recommendations/client-home.types.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import type { WatchInternalRef } from './watch-read.types.js';

export class WatchCardHydrator {
  private readonly metadataCardService: MetadataCardService;
  private readonly contentIdentityService: ContentIdentityService;

  constructor(
    metadataCardService: MetadataCardService = new MetadataCardService(),
    contentIdentityService: ContentIdentityService = new ContentIdentityService(),
  ) {
    this.metadataCardService = metadataCardService;
    this.contentIdentityService = contentIdentityService;
  }

  /**
   * Last-layer hydration: Brain 1 (itemId + per-user progress) → Brain 2 (ClientMediaCard).
   * Enrichment happens once, at the route boundary.
   */
  async hydrateByIds(client: DbClient, refs: WatchInternalRef[], language?: string | null): Promise<import('../recommendations/client-home.types.js').ClientMediaCard[]> {
    if (refs.length === 0) return [];

    const contentIds = refs.map((ref) => assertPublicItemId(ref.itemId));
    const identityByContentId = await this.contentIdentityService.resolveMediaIdentitiesBatched(client, contentIds);

    const ordered: Array<{ ref: WatchInternalRef; identity: MediaIdentity }> = [];
    for (const ref of refs) {
      const identity = identityByContentId.get(assertPublicItemId(ref.itemId));
      if (identity) ordered.push({ ref, identity });
    }
    if (!ordered.length) return [];

    const views = await this.metadataCardService.buildCardViewsForIdentities(
      client,
      ordered.map((entry) => entry.identity),
      language ?? null,
    );

    const cards: import('../recommendations/client-home.types.js').ClientMediaCard[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const entry = ordered[i]!;
      const view = views[i];
      if (!view || !view.title) continue;
      cards.push(toClientMediaCard(view, {
        progress: progressFromInternalRef(entry.ref, view),
        itemId: entry.ref.itemId,
      }));
    }
    return cards;
  }
}

function progressFromInternalRef(
  ref: WatchInternalRef,
  view: import('../metadata/metadata-card.types.js').MetadataCardView,
): ClientProgress | null {
  const progress = ref.progress;
  if (!progress) return null;
  const positionSeconds = progress.positionSeconds;
  const viewDuration = typeof view.runtimeMinutes === 'number' ? view.runtimeMinutes * 60 : null;
  const durationSeconds = viewDuration ?? progress.durationSeconds;
  let percent: number | null = progress.progressBps != null ? progress.progressBps / 100 : null;
  if (percent == null && positionSeconds != null && durationSeconds != null && durationSeconds > 0) {
    percent = (positionSeconds / durationSeconds) * 100;
  }
  return {
    played: progress.played,
    playCount: progress.playCount,
    positionSeconds,
    durationSeconds,
    percent,
    lastPlayedAt: progress.lastPlayedAt,
    watchlisted: progress.isFavorite,
    userRating: progress.rating,
  };
}
