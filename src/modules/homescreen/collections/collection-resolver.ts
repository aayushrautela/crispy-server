import { withDbClient, type DbClient } from '../../../lib/db.js';
import { ContentIdentityService } from '../../identity/content-identity.service.js';
import { MetadataCardService } from '../../metadata/metadata-card.service.js';
import type { MetadataCardView } from '../../metadata/metadata-card.types.js';
import { inferMediaIdentity, type MediaIdentity } from '../../identity/media-key.js';
import type { ClientMediaCard, ClientHomeSection, ClientMediaType } from '../../recommendations/client-home.types.js';
import type { CollectionRecord, ProviderRef } from '../homescreen.types.js';

const MAX_COLLECTION_ITEMS = 20;

export class CollectionResolver {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly metadataCardService = new MetadataCardService(),
  ) {}

  async resolveToSection(record: CollectionRecord, locale: string): Promise<ClientHomeSection | null> {
    if (record.providerRefs.length === 0) {
      return null;
    }
    const cards = await withDbClient((client: DbClient) => this.resolveCards(client, record.providerRefs, locale));
    if (cards.length === 0) {
      return null;
    }
    return {
      listKey: `collection-${record.key}`,
      title: record.title,
      subtitle: record.subtitle,
      sectionType: 'collectionRail',
      items: cards,
      meta: { collectionKey: record.key, source: record.source },
    };
  }

  private async resolveCards(client: DbClient, refs: ProviderRef[], locale: string) {
    const identities: MediaIdentity[] = [];
    for (const ref of refs) {
      const mediaType = ref.type === 'tv' ? 'show' : ref.type === 'movie' ? 'movie' : null;
      if (!mediaType) {
        continue;
      }
      identities.push(inferMediaIdentity({
        mediaType,
        provider: ref.provider as never,
        providerId: ref.providerId,
      }));
    }

    const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);
    const cards: ClientMediaCard[] = [];
    for (const identity of identities) {
      const contentId = identity.mediaKey ? contentIds.get(identity.mediaKey) : undefined;
      if (!contentId) {
        continue;
      }
      const resolved = await this.contentIdentityService.resolveMediaIdentity(client, contentId);
      const view = await this.metadataCardService.buildCardView(client, resolved, locale);
      if (view && view.title) {
        cards.push(buildCard({ ...view, title: view.title }));
      }
    }
    return cards.slice(0, MAX_COLLECTION_ITEMS);
  }
}

function buildCard(view: MetadataCardView & { title: string }): ClientHomeSection['items'][number] {
  const mediaType: ClientMediaType = view.mediaType === 'show' ? 'tv' : 'movie';
  return {
    itemId: view.itemId,
    mediaType,
    title: view.title,
    subtitle: view.subtitle,
    overview: view.overview,
    year: view.releaseYear,
    releaseDate: view.releaseDate,
    rating: view.rating,
    maturityRating: view.maturityRating,
    genres: view.genres,
    runtimeSeconds: typeof view.runtimeMinutes === 'number' ? view.runtimeMinutes * 60 : null,
    images: {
      poster: view.images.poster,
      backdrop: view.images.backdrop,
      logo: view.images.logo,
      still: view.images.still,
    },
    progress: null,
    parent: null,
  };
}
